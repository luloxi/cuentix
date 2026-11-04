import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  HOUSEHOLD_NAME_EMPTY,
  HOUSEHOLD_NAME_RESERVED,
  HOUSEHOLD_NAME_TOO_LONG,
} from "../src/lib/household-name";
import type { SessionUser } from "./auth";
import type { Env } from "./env";
import { LIST_HOUSEHOLDS_SQL, listHouseholds } from "./household";
import {
  COUNT_MEMBERSHIPS_SQL,
  HOUSEHOLD_CAP_ERROR,
  HOUSEHOLD_DUPLICATE_ERROR,
  HOUSEHOLD_NAMES_SQL,
  INVITE_ALPHABET,
  INVITE_LEN,
  charsFromBytes,
  generateInviteCode,
  handleHouseholdCreate,
} from "./household-create";
import { handleHouseholdActive } from "./household-routes";
import worker from "./index";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const user: SessionUser = {
  id: "user-a",
  email: "a@example.com",
  name: "Member A",
  image: null,
};

const MIGRATIONS = [
  "0001_app.sql",
  "0002_auth.sql",
  "0003_serpix_sync.sql",
  "0004_card_closed.sql",
  "0005_patrimonio_snapshots.sql",
  "0006_patrimonio_user_date.sql",
  "0007_perf_indexes.sql",
];

type Bound = {
  _sql: string;
  _params: () => unknown[];
  bind: (...values: unknown[]) => Bound;
  all: () => Promise<{ results: Record<string, unknown>[] }>;
  first: () => Promise<Record<string, unknown> | null>;
  run: () => Promise<{ meta: { changes: number } }>;
};

type Log = {
  sql: string[];
  batch: Array<Array<{ sql: string; params: unknown[] }>>;
};

function openDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of MIGRATIONS) {
    db.exec(readFileSync(join(root, "migrations", file), "utf8"));
  }
  return db;
}

function wrap(db: DatabaseSync, log: Log) {
  return {
    prepare(sql: string) {
      let params: unknown[] = [];
      const stmt: Bound = {
        _sql: sql,
        _params: () => params,
        bind(...values: unknown[]) {
          params = values;
          return stmt;
        },
        async all() {
          log.sql.push(sql);
          return { results: db.prepare(sql).all(...(params as never[])) as Record<string, unknown>[] };
        },
        async first() {
          log.sql.push(sql);
          return (db.prepare(sql).get(...(params as never[])) as Record<string, unknown> | undefined) ?? null;
        },
        async run() {
          log.sql.push(sql);
          const info = db.prepare(sql).run(...(params as never[])) as { changes?: number };
          return { meta: { changes: Number(info.changes ?? 0) } };
        },
      };
      return stmt;
    },
    async batch(statements: Bound[]) {
      log.batch.push(statements.map((s) => ({ sql: s._sql, params: s._params() })));
      db.exec("BEGIN");
      try {
        const results = statements.map((s) => {
          const info = db.prepare(s._sql).run(...(s._params() as never[])) as { changes?: number };
          return { meta: { changes: Number(info.changes ?? 0) } };
        });
        db.exec("COMMIT");
        return results;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  };
}

function envFor(db: DatabaseSync, log: Log = { sql: [], batch: [] }): Env {
  return {
    DB: wrap(db, log) as Env["DB"],
    RECEIPTS: { put: async () => null, get: async () => null },
    AI: { toMarkdown: async () => null },
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
  };
}

function seedUser(db: DatabaseSync) {
  db.prepare("INSERT INTO users (id, email, name) VALUES ('user-a', 'a@example.com', 'Member A')").run();
  db.prepare("INSERT INTO users (id, email, name) VALUES ('user-b', 'b@example.com', 'Member B')").run();
  db.prepare(
    "INSERT INTO households (id, name, invite_code) VALUES ('h-other', 'Ajeno', 'ZZZZZZZZ')",
  ).run();
  db.prepare(
    "INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES ('h-other', 'user-b', 'owner', 1)",
  ).run();
}

function seedOlder(db: DatabaseSync) {
  db.prepare(
    "INSERT INTO households (id, name, invite_code) VALUES ('h-old', 'Viejo', 'YYYYYYYY')",
  ).run();
  db.prepare(
    "INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES ('h-old', 'user-a', 'owner', 1)",
  ).run();
}

function post(body: unknown, headers?: Record<string, string>): Request {
  return new Request("https://cuentix.test/api/household", {
    method: "POST",
    headers: {
      origin: "https://cuentix.test",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function planOf(db: DatabaseSync, sql: string): string {
  const rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>;
  return rows.map((row) => row.detail).join("\n");
}

function count(db: DatabaseSync, sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...(params as never[])) as { n: number };
  return Number(row.n);
}

describe("invite code", () => {
  it("uses the alphabet, is 8 characters, and rejects biased leftovers", () => {
    assert.equal(INVITE_ALPHABET.length, 32);
    assert.equal(/[IO01]/.test(INVITE_ALPHABET), false);
    const counts = { A: 0, B: 0, C: 0 };
    let skipped = 0;
    for (let byte = 0; byte < 256; byte++) {
      const ch = charsFromBytes(Uint8Array.of(byte), "ABC", 1);
      if (!ch) skipped += 1;
      else counts[ch as "A" | "B" | "C"] += 1;
    }
    assert.equal(skipped, 1);
    assert.deepEqual(counts, { A: 85, B: 85, C: 85 });

    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const code = generateInviteCode();
      assert.match(code, new RegExp(`^[${INVITE_ALPHABET}]{${INVITE_LEN}}$`));
      seen.add(code);
    }
    assert.equal(seen.size, 30);
  });
});

describe("POST /api/household", () => {
  it("creates one owner household, sets the cookie, and lists it first", async () => {
    const db = openDb();
    seedUser(db);
    seedOlder(db);
    const log: Log = { sql: [], batch: [] };
    const env = envFor(db, log);
    const res = await handleHouseholdCreate(
      post({
        action: "create",
        name: "  Casa   Norte \n",
        role: "member",
        id: "client-id",
        inviteCode: "HACKED00",
        additional: true,
      }),
      env,
      user,
    );
    assert.equal(res.status, 201);
    const body = (await res.json()) as {
      ok: boolean;
      activeHouseholdId: string;
      household: { household: { id: string; name: string; inviteCode: string }; role: string };
      households: Array<{ id: string; name: string; role: string }>;
    };
    assert.equal(body.ok, true);
    assert.equal(body.household.role, "owner");
    assert.equal(body.household.household.name, "Casa Norte");
    assert.match(body.household.household.inviteCode, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    assert.notEqual(body.household.household.id, "client-id");
    assert.notEqual(body.household.household.inviteCode, "HACKED00");
    assert.equal(body.activeHouseholdId, body.household.household.id);
    assert.equal(body.households[0]?.id, body.household.household.id);
    assert.equal(JSON.stringify(body).includes("ZZZZZZZZ"), false);
    assert.equal(JSON.stringify(body).includes("Ajeno"), false);
    assert.equal(JSON.stringify(body).includes("user-b"), false);

    const cookie = res.headers.get("set-cookie") ?? "";
    assert.match(cookie, new RegExp(`lc_household=${body.household.household.id}`));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);

    const list = await listHouseholds(env, user.id);
    assert.equal(list[0]?.id, body.household.household.id);
    assert.equal(list[0]?.role, "owner");

    assert.equal(count(db, "SELECT COUNT(*) AS n FROM households WHERE id = ?", body.household.household.id), 1);
    assert.equal(
      count(db, "SELECT COUNT(*) AS n FROM household_members WHERE household_id = ?", body.household.household.id),
      1,
    );
    const member = db
      .prepare("SELECT role, user_id FROM household_members WHERE household_id = ?")
      .get(body.household.household.id) as { role: string; user_id: string };
    assert.equal(member.role, "owner");
    assert.equal(member.user_id, user.id);

    assert.equal(log.batch.length, 1);
    assert.equal(log.batch[0]?.length, 2);
    assert.match(log.batch[0]?.[0]?.sql ?? "", /INSERT INTO households/i);
    assert.match(log.batch[0]?.[1]?.sql ?? "", /INSERT INTO household_members/i);
    assert.match(log.batch[0]?.[1]?.sql ?? "", /'owner'/);
    assert.equal(log.batch[0]?.[1]?.params.includes("member"), false);
    assert.equal(log.batch[0]?.[0]?.params.includes("HACKED00"), false);
    assert.equal(log.batch[0]?.[0]?.params.includes("client-id"), false);
    assert.equal(log.sql.some((sql) => sql.startsWith("INSERT")), false);
    assert.equal(log.sql.includes(COUNT_MEMBERSHIPS_SQL), true);
    assert.equal(log.sql.includes(HOUSEHOLD_NAMES_SQL), true);
    assert.match(planOf(db, COUNT_MEMBERSHIPS_SQL), /hm_user_idx/);
    assert.match(planOf(db, HOUSEHOLD_NAMES_SQL), /hm_user_idx/);
    assert.match(planOf(db, LIST_HOUSEHOLDS_SQL), /hm_user_idx/);

    const active = await handleHouseholdActive(
      new Request("https://cuentix.test/api/household/active", {
        headers: { cookie },
      }),
      env,
      user,
    );
    const activeBody = (await active.json()) as { activeHouseholdId: string | null };
    assert.equal(activeBody.activeHouseholdId, body.household.household.id);

    const summary = await handleHouseholdCreate(
      new Request("https://cuentix.test/api/household", { headers: { cookie } }),
      env,
      user,
    );
    assert.equal(summary.status, 200);
    const summaryBody = (await summary.json()) as {
      household: { household: { id: string; inviteCode: string }; role: string };
    };
    assert.equal(summaryBody.household.household.id, body.household.household.id);
    assert.equal(summaryBody.household.household.inviteCode, body.household.household.inviteCode);
    assert.equal(summaryBody.household.role, "owner");
  });

  it("retries a colliding invite code and stops after 3 unique failures", async () => {
    const db = openDb();
    seedUser(db);
    db.prepare(
      "INSERT INTO households (id, name, invite_code) VALUES ('h-taken', 'Ocupado', 'AAAAAAAA')",
    ).run();
    const codes = ["AAAAAAAA", "AAAAAAAA", "BBBBBBBB"];
    let n = 0;
    const res = await handleHouseholdCreate(post({ action: "create", name: "Trabajo" }), envFor(db), user, {
      inviteCode: () => codes[n++] ?? "CCCCCCCC",
    });
    assert.equal(res.status, 201);
    assert.equal(n, 3);
    const body = (await res.json()) as { household: { household: { inviteCode: string } } };
    assert.equal(body.household.household.inviteCode, "BBBBBBBB");
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM household_members WHERE user_id = ?", user.id), 1);

    let attempts = 0;
    const again = await handleHouseholdCreate(
      post({ action: "create", name: "Otro", additional: true }),
      envFor(db),
      user,
      {
        inviteCode: () => {
          attempts += 1;
          return "AAAAAAAA";
        },
      },
    );
    assert.equal(again.status, 500);
    assert.equal(attempts, 3);
    const failure = (await again.json()) as { error: string };
    assert.equal(failure.error, "No se pudo crear el hogar");
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM households WHERE name = ?", "Otro"), 0);
  });

  it("does not retry a non-unique insert failure and hides the driver error", async () => {
    let calls = 0;
    const env = {
      DB: {
        prepare() {
          const stmt = {
            bind() {
              return stmt;
            },
            async all() {
              return { results: [] as Record<string, unknown>[] };
            },
            async first() {
              return { n: 0 };
            },
            async run() {
              return { meta: { changes: 0 } };
            },
          };
          return stmt;
        },
        async batch() {
          calls += 1;
          throw new Error("disk full");
        },
      },
      RECEIPTS: { put: async () => null, get: async () => null },
      AI: { toMarkdown: async () => null },
      ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    } as Env;
    const res = await handleHouseholdCreate(post({ action: "create", name: "Casa" }), env, user);
    assert.equal(res.status, 500);
    assert.equal(calls, 1);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "No se pudo crear el hogar");
    assert.equal(JSON.stringify(body).includes("disk"), false);
  });

  it("rejects a duplicate name and the 10-household cap", async () => {
    const db = openDb();
    seedUser(db);
    const env = envFor(db);
    const first = await handleHouseholdCreate(post({ action: "create", name: "Casa Blanca" }), env, user);
    assert.equal(first.status, 201);
    const second = await handleHouseholdCreate(
      post({ action: "create", name: "  casa   blanca ", additional: true }),
      env,
      user,
    );
    assert.equal(second.status, 409);
    const dup = (await second.json()) as { error: string };
    assert.equal(dup.error, HOUSEHOLD_DUPLICATE_ERROR);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM households WHERE name LIKE 'Casa%'"), 1);

    const capped = openDb();
    seedUser(capped);
    for (let i = 0; i < 10; i++) {
      const id = `h-cap-${i}`;
      capped.prepare("INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)").run(id, `Hogar ${i}`, `CODE${i}XXX`);
      capped
        .prepare(
          "INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES (?, 'user-a', 'owner', ?)",
        )
        .run(id, i + 1);
    }
    const idempotent = await handleHouseholdCreate(
      post({ action: "create", name: "Mi espacio" }),
      envFor(capped),
      user,
    );
    assert.equal(idempotent.status, 200);
    const idempotentBody = (await idempotent.json()) as { existing?: boolean };
    assert.equal(idempotentBody.existing, true);
    assert.equal(count(capped, "SELECT COUNT(*) AS n FROM household_members WHERE user_id = ?", user.id), 10);

    const blocked = await handleHouseholdCreate(
      post({ action: "create", name: "Uno mas", additional: true }),
      envFor(capped),
      user,
    );
    assert.equal(blocked.status, 409);
    const capBody = (await blocked.json()) as { error: string };
    assert.equal(capBody.error, HOUSEHOLD_CAP_ERROR);
    assert.equal(count(capped, "SELECT COUNT(*) AS n FROM household_members WHERE user_id = ?", user.id), 10);
  });

  it("rejects reserved names, a bad origin, a bad content type, and unknown actions", async () => {
    const db = openDb();
    seedUser(db);
    const env = envFor(db);
    for (const name of ["Invoice IOG", "casita"]) {
      const res = await handleHouseholdCreate(post({ action: "create", name }), env, user);
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error: string };
      assert.equal(body.error, HOUSEHOLD_NAME_RESERVED);
    }
    for (const name of ["Personal", " mi espacio ", "Invoice IOG", "casita"]) {
      const res = await handleHouseholdCreate(
        post({ action: "create", name, additional: true }),
        env,
        user,
      );
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error: string };
      assert.equal(body.error, HOUSEHOLD_NAME_RESERVED);
    }
    const empty = await handleHouseholdCreate(post({ action: "create", name: "   " }), env, user);
    assert.equal(empty.status, 400);
    assert.equal(((await empty.json()) as { error: string }).error, HOUSEHOLD_NAME_EMPTY);
    const long = await handleHouseholdCreate(
      post({ action: "create", name: "a".repeat(61) }),
      env,
      user,
    );
    assert.equal(long.status, 400);
    assert.equal(((await long.json()) as { error: string }).error, HOUSEHOLD_NAME_TOO_LONG);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM household_members WHERE user_id = ?", user.id), 0);

    const evil = await handleHouseholdCreate(
      post({ action: "create", name: "Oficina" }, { origin: "https://evil.test" }),
      env,
      user,
    );
    assert.equal(evil.status, 403);

    const text = await handleHouseholdCreate(
      new Request("https://cuentix.test/api/household", {
        method: "POST",
        headers: { origin: "https://cuentix.test", "content-type": "text/plain" },
        body: JSON.stringify({ action: "create", name: "Oficina" }),
      }),
      env,
      user,
    );
    assert.equal(text.status, 415);

    const charset = await handleHouseholdCreate(
      post({ action: "create", name: "Oficina" }, { "content-type": "Application/JSON; charset=utf-8" }),
      env,
      user,
    );
    assert.equal(charset.status, 201);

    const join = await handleHouseholdCreate(post({ action: "join", code: "ABCDEFGH" }), env, user);
    assert.equal(join.status, 501);
    const joinBody = (await join.json()) as { code?: string };
    assert.equal(joinBody.code, "not_ported");

    const other = await handleHouseholdCreate(post({ action: "delete", name: "Oficina" }), env, user);
    assert.equal(other.status, 400);
    const missing = await handleHouseholdCreate(post({ name: "Oficina" }), env, user);
    assert.equal(missing.status, 400);

    const put = await handleHouseholdCreate(
      new Request("https://cuentix.test/api/household", { method: "PUT" }),
      env,
      user,
    );
    assert.equal(put.status, 405);
  });

  it("creates the first solo household named Mi espacio and repeats the existing one", async () => {
    const db = openDb();
    seedUser(db);
    const created = await handleHouseholdCreate(post({ action: "create", name: "Mi espacio" }), envFor(db), user);
    assert.equal(created.status, 201);
    const first = (await created.json()) as {
      ok: boolean;
      existing?: boolean;
      activeHouseholdId: string;
      household: { household: { id: string; name: string; inviteCode: string }; role: string };
    };
    assert.equal(first.ok, true);
    assert.equal(first.existing, undefined);
    assert.equal(first.household.role, "owner");
    assert.equal(first.household.household.name, "Mi espacio");
    assert.equal(first.activeHouseholdId, first.household.household.id);
    const id = first.household.household.id;
    const inviteCode = first.household.household.inviteCode;
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM household_members WHERE user_id = ?", user.id), 1);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM households WHERE name = ?", "Mi espacio"), 1);

    const log: Log = { sql: [], batch: [] };
    const again = await handleHouseholdCreate(
      post({ action: "create", name: "Mi espacio" }),
      envFor(db, log),
      user,
    );
    assert.equal(again.status, 200);
    const second = (await again.json()) as {
      ok: boolean;
      existing: boolean;
      activeHouseholdId: string;
      household: { household: { id: string; name: string; inviteCode: string }; role: string };
      households: Array<{ id: string }>;
    };
    assert.equal(second.ok, true);
    assert.equal(second.existing, true);
    assert.equal(second.activeHouseholdId, id);
    assert.equal(second.household.role, "owner");
    assert.equal(second.household.household.id, id);
    assert.equal(second.household.household.name, "Mi espacio");
    assert.equal(second.household.household.inviteCode, inviteCode);
    assert.equal(second.households.some((row) => row.id === id), true);
    const cookie = again.headers.get("set-cookie") ?? "";
    assert.match(cookie, new RegExp(`lc_household=${id}`));
    assert.match(cookie, /HttpOnly/);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM household_members WHERE user_id = ?", user.id), 1);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM households WHERE name = ?", "Mi espacio"), 1);
    assert.equal(log.batch.length, 0);
    assert.equal(log.sql.includes(COUNT_MEMBERSHIPS_SQL), true);
    assert.equal(log.sql.includes(HOUSEHOLD_NAMES_SQL), false);
    assert.equal(log.sql.some((sql) => sql.startsWith("INSERT")), false);

    const renamed = await handleHouseholdCreate(post({ action: "create", name: "Oficina" }), envFor(db), user);
    assert.equal(renamed.status, 200);
    const third = (await renamed.json()) as {
      existing: boolean;
      household: { household: { id: string } };
    };
    assert.equal(third.existing, true);
    assert.equal(third.household.household.id, id);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM households WHERE name = ?", "Oficina"), 0);
  });

  it("rejects an additional household named Mi espacio", async () => {
    const db = openDb();
    seedUser(db);
    const res = await handleHouseholdCreate(
      post({ action: "create", name: "Mi espacio", additional: true }),
      envFor(db),
      user,
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, HOUSEHOLD_NAME_RESERVED);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM household_members WHERE user_id = ?", user.id), 0);

    seedOlder(db);
    const again = await handleHouseholdCreate(
      post({ action: "create", name: "Mi espacio", additional: true }),
      envFor(db),
      user,
    );
    assert.equal(again.status, 400);
    assert.equal(((await again.json()) as { error: string }).error, HOUSEHOLD_NAME_RESERVED);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM households WHERE name = ?", "Mi espacio"), 0);
  });

  it("keeps /api/household behind requireUser", async () => {
    const src = readFileSync(join(root, "worker/index.ts"), "utf8");
    const lines = src.split("\n");
    const guardAt = lines.findIndex((line) => line.includes("if (!isUser(user)) return user"));
    const createAt = lines.findIndex((line) => line.includes('path === "/api/household")'));
    assert.equal(guardAt >= 0, true);
    assert.equal(createAt > guardAt, true);

    const env = {
      DB: {
        prepare() {
          throw new Error("DB usado sin sesión");
        },
        async batch() {
          throw new Error("DB usado sin sesión");
        },
      },
      RECEIPTS: { put: async () => null, get: async () => null },
      AI: { toMarkdown: async () => null },
      ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    } as Env;
    const res = await worker.fetch(
      new Request("https://cuentix.test/api/household", {
        method: "POST",
        headers: {
          origin: "https://cuentix.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "create", name: "Casa" }),
      }),
      env,
    );
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "No autenticado");
  });
});
