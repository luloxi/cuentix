import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Env, WorkerContext } from "./env";
import worker from "./index";
import {
  MAX_SYNC_ATTEMPTS,
  buildDeletePayload,
  buildUpsertPayload,
  decimalTextToMinor,
  enqueueOutboxStatements,
  flushOutbox,
  signSyncBody,
  syncBackoffMs,
} from "./serpix-sync";
import { handleTransactions } from "./transactions";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const user = { id: "u1", email: "a@b.co", name: "Ana", image: null };

type LogEntry =
  | { kind: "all" | "first" | "run"; sql: string }
  | { kind: "batch"; sqls: string[] };

type Bound = {
  bind(...values: unknown[]): Bound;
  all(): Promise<{ results?: Record<string, unknown>[] }>;
  first(): Promise<Record<string, unknown> | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
  _sql: string;
  _params(): unknown[];
};

function openDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of ["0001_app.sql", "0002_auth.sql", "0003_serpix_sync.sql"]) {
    db.exec(readFileSync(join(root, "migrations", file), "utf8"));
  }
  return db;
}

function wrap(db: DatabaseSync, log: LogEntry[]) {
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
          log.push({ kind: "all", sql });
          return { results: db.prepare(sql).all(...params) as Record<string, unknown>[] };
        },
        async first() {
          log.push({ kind: "first", sql });
          return (db.prepare(sql).get(...params) as Record<string, unknown> | undefined) ?? null;
        },
        async run() {
          log.push({ kind: "run", sql });
          const info = db.prepare(sql).run(...params) as { changes?: number };
          return { meta: { changes: Number(info.changes ?? 0) } };
        },
      };
      return stmt;
    },
    async batch(statements: Bound[]) {
      const bound = statements;
      log.push({ kind: "batch", sqls: bound.map((s) => s._sql) });
      db.exec("BEGIN");
      try {
        const results = bound.map((s) => {
          const info = db.prepare(s._sql).run(...s._params()) as { changes?: number };
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

function envFor(db: DatabaseSync, log: LogEntry[], extra: Partial<Env> = {}): Env {
  return {
    DB: wrap(db, log) as Env["DB"],
    RECEIPTS: { put: async () => null, get: async () => null },
    AI: { toMarkdown: async () => null },
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    CUENTIX_SYNC_SECRET: "test-secret-not-real",
    SERPIX_SYNC_URL: "https://serpix-sync.test/events",
    ...extra,
  };
}

function seedTx(
  db: DatabaseSync,
  row: {
    id?: string;
    ars?: string | null;
    usd?: string | null;
    payment?: number;
    credit?: number;
    ownership?: string;
    fingerprint?: string;
  } = {},
) {
  db.prepare("INSERT INTO users (id, email, name) VALUES ('u1', 'a@b.co', 'Ana')").run();
  db.prepare(
    "INSERT INTO households (id, name, invite_code) VALUES ('h1', 'Personal', 'CODE1234')",
  ).run();
  db.prepare(
    "INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES ('h1', 'u1', 'owner', 1)",
  ).run();
  db.prepare(
    "INSERT INTO categories (id, slug, name, kind) VALUES ('c1', 'supermercado', 'Supermercado', 'expense')",
  ).run();
  db.prepare(
    `INSERT INTO transactions (
       id, household_id, date, description_raw, description_normalized,
       amount_ars, amount_usd, is_payment, is_credit, category_id, ownership,
       paid_by_user_id, external_fingerprint, source
     ) VALUES (?, 'h1', '2026-01-15', 'DIA TIENDA', 'DIA TIENDA', ?, ?, ?, ?, 'c1', ?, 'u1', ?, 'manual')`,
  ).run(
    row.id ?? "t1",
    row.ars === undefined ? "16961.25" : row.ars,
    row.usd === undefined ? null : row.usd,
    row.payment ?? 0,
    row.credit ?? 0,
    row.ownership ?? "personal",
    row.fingerprint ?? "fp1",
  );
}

function ctxOf(): WorkerContext & { pending: Promise<unknown>[] } {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
  };
}

function patch(body: unknown): Request {
  return new Request("https://cuentix.test/api/transactions", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

type Captured = { headers: Headers; body: string };

function installFetch(handler: (call: Captured) => Response | Promise<Response>): {
  calls: Captured[];
  restore: () => void;
} {
  const calls: Captured[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const captured = {
      headers: new Headers(init?.headers),
      body: String(init?.body ?? ""),
    };
    calls.push(captured);
    return handler(captured);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = previous; } };
}

describe("decimal text to minor units", () => {
  it("uses string math and does not drift on binary fractions", () => {
    assert.equal(decimalTextToMinor("16961.25"), 1_696_125);
    assert.equal(decimalTextToMinor("10.5"), 1050);
    assert.equal(decimalTextToMinor("10.50"), 1050);
    assert.equal(decimalTextToMinor("0.29"), 29);
    assert.equal(decimalTextToMinor("0.1"), 10);
    assert.equal(decimalTextToMinor("-12.30"), 1230);
    assert.equal(decimalTextToMinor("1.005"), 101);
    assert.equal(decimalTextToMinor("1.004"), 100);
    assert.equal(decimalTextToMinor("1,25"), 125);
    assert.equal(decimalTextToMinor("0.28999999999999998"), 29);
    assert.throws(() => decimalTextToMinor("nope"));
  });
});

describe("contract vector", () => {
  it("reproduces the shared HMAC vector", async () => {
    const vector = JSON.parse(
      readFileSync(join(root, "contract/cuentix-sync-vector.json"), "utf8"),
    ) as {
      secret: string;
      timestamp: string | number;
      nonce: string;
      body: string;
      signature: string;
    };
    const timestamp = String(vector.timestamp);
    assert.equal(vector.secret, "test-secret-not-real");
    assert.equal(timestamp, "1700000000000");
    assert.equal(vector.nonce, "00112233445566778899aabbccddeeff");
    const signed = await signSyncBody(vector.secret, timestamp, vector.nonce, vector.body);
    const viaNode =
      "v1=" +
      createHmac("sha256", vector.secret)
        .update(`${timestamp}.${vector.nonce}.${vector.body}`)
        .digest("hex");
    assert.equal(signed, vector.signature);
    assert.equal(signed, viaNode);
    const shared = "/workspace/cuentix-serpix/cuentix-sync-vector.json";
    assert.equal(readFileSync(shared, "utf8"), readFileSync(join(root, "contract/cuentix-sync-vector.json"), "utf8"));
  });
});

describe("payload", () => {
  it("builds an upsert with kind, currency and integer cents", () => {
    const built = buildUpsertPayload({
      eventId: "11111111-1111-4111-8111-111111111111",
      sourceId: "t1",
      version: 50,
      occurredAt: "2026-01-15",
      isCredit: 1,
      amountArs: null,
      amountUsd: "10.50",
      description: "Cobro",
      categoryName: "",
      categorySlug: "",
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;
    const body = JSON.parse(built.body) as {
      kind: string;
      currency: string;
      amount_minor: number;
      category: string;
    };
    assert.equal(body.kind, "income");
    assert.equal(body.currency, "USD");
    assert.equal(body.amount_minor, 1050);
    assert.equal(body.category, "Cuentix");
    assert.match(built.body, /"amount_minor":1050/);

    const both = buildUpsertPayload({
      eventId: "e",
      sourceId: "t1",
      version: 1,
      occurredAt: "2026-01-15",
      isCredit: 0,
      amountArs: "1.00",
      amountUsd: "9.00",
      description: "Mix",
      categoryName: "Supermercado",
      categorySlug: "supermercado",
    });
    assert.equal(both.ok, true);
    if (!both.ok) return;
    const mixed = JSON.parse(both.body) as { currency: string; amount_minor: number; kind: string };
    assert.equal(mixed.currency, "ARS");
    assert.equal(mixed.amount_minor, 100);
    assert.equal(mixed.kind, "expense");
  });

  it("delete payload keeps only the identity fields", () => {
    const raw = buildDeletePayload({ eventId: "e1", sourceId: "t1", version: 9 });
    assert.deepEqual(Object.keys(JSON.parse(raw)), [
      "v",
      "event_id",
      "type",
      "source",
      "source_id",
      "version",
    ]);
  });
});

describe("outbox flush", () => {
  function insertOutbox(
    db: DatabaseSync,
    row: { id: string; created: number; payload: string; attempts?: number; next?: number | null },
  ) {
    db.prepare(
      `INSERT INTO serpix_outbox (
         id, tx_id, event_id, type, payload, created_at, attempts, next_attempt_at
       ) VALUES (?, 't1', ?, 'upsert', ?, ?, ?, ?)`,
    ).run(row.id, `ev-${row.id}`, row.payload, row.created, row.attempts ?? 0, row.next ?? null);
  }

  it("retries with backoff and marks sent on success", async () => {
    const db = openDb();
    insertOutbox(db, { id: "o1", created: 1, payload: "{\"v\":1}" });
    const log: LogEntry[] = [];
    const env = envFor(db, log);
    const calls: number[] = [];
    await flushOutbox(env, ["o1"], {
      now: 1_000,
      fetchImpl: async () => {
        calls.push(1);
        return new Response("no", { status: 500 });
      },
    });
    const failed = db.prepare("SELECT attempts, next_attempt_at, sent_at, failed_at FROM serpix_outbox WHERE id = 'o1'").get() as {
      attempts: number;
      next_attempt_at: number;
      sent_at: number | null;
      failed_at: number | null;
    };
    assert.equal(failed.attempts, 1);
    assert.equal(failed.sent_at, null);
    assert.equal(failed.failed_at, null);
    assert.equal(failed.next_attempt_at, 1_000 + syncBackoffMs(1));

    await flushOutbox(env, ["o1"], {
      now: failed.next_attempt_at - 1,
      fetchImpl: async () => {
        calls.push(2);
        return new Response("no", { status: 200 });
      },
    });
    assert.deepEqual(calls, [1]);

    await flushOutbox(env, ["o1"], {
      now: failed.next_attempt_at,
      fetchImpl: async () => {
        calls.push(3);
        return new Response("{\"ok\":true}", { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    const sent = db.prepare("SELECT sent_at, attempts FROM serpix_outbox WHERE id = 'o1'").get() as {
      sent_at: number;
      attempts: number;
    };
    assert.equal(sent.sent_at, failed.next_attempt_at);
    assert.equal(sent.attempts, 1);
    assert.deepEqual(calls, [1, 3]);
  });

  it("stops after the attempt cap and on a permanent 4xx", async () => {
    const db = openDb();
    insertOutbox(db, { id: "o1", created: 1, payload: "{}", attempts: MAX_SYNC_ATTEMPTS - 1 });
    const env = envFor(db, []);
    let fetches = 0;
    await flushOutbox(env, ["o1"], {
      now: 5_000,
      fetchImpl: async () => {
        fetches += 1;
        return new Response("no", { status: 401 });
      },
    });
    const row = db.prepare("SELECT attempts, failed_at FROM serpix_outbox WHERE id = 'o1'").get() as {
      attempts: number;
      failed_at: number;
    };
    assert.equal(fetches, 1);
    assert.equal(row.attempts, MAX_SYNC_ATTEMPTS);
    assert.equal(row.failed_at, 5_000);
    await flushOutbox(env, ["o1"], {
      now: 9_000,
      fetchImpl: async () => {
        fetches += 1;
        return new Response("ok", { status: 200 });
      },
    });
    assert.equal(fetches, 1);

    insertOutbox(db, { id: "o2", created: 2, payload: "{}" });
    await flushOutbox(env, ["o2"], {
      now: 6_000,
      fetchImpl: async () => new Response("bad", { status: 400 }),
    });
    const permanent = db.prepare("SELECT failed_at, sent_at FROM serpix_outbox WHERE id = 'o2'").get() as {
      failed_at: number;
      sent_at: number | null;
    };
    assert.equal(permanent.failed_at, 6_000);
    assert.equal(permanent.sent_at, null);
  });

  it("does not send an older event on a later cron tick", async () => {
    const db = openDb();
    insertOutbox(db, { id: "old", created: 10, payload: "{\"version\":1}" });
    insertOutbox(db, { id: "new", created: 20, payload: "{\"version\":2}" });
    const env = envFor(db, []);
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      bodies.push(String(init?.body ?? ""));
      return new Response("{\"ok\":true}", { status: 200 });
    };
    await flushOutbox(env, undefined, { now: 100, fetchImpl });
    await flushOutbox(env, undefined, { now: 200, fetchImpl });
    assert.deepEqual(bodies, ["{\"version\":2}"]);
    const old = db.prepare("SELECT last_error, sent_at FROM serpix_outbox WHERE id = 'old'").get() as {
      last_error: string;
      sent_at: number;
    };
    assert.equal(old.last_error, "coalesced");
    assert.equal(old.sent_at, 100);
  });

  it("sends only the newest pending event for a movement", async () => {
    const db = openDb();
    insertOutbox(db, { id: "old", created: 10, payload: "{\"version\":1}" });
    insertOutbox(db, { id: "new", created: 20, payload: "{\"version\":2}" });
    const env = envFor(db, []);
    const bodies: string[] = [];
    await flushOutbox(env, ["new"], {
      now: 100,
      fetchImpl: async (_input, init) => {
        bodies.push(String(init?.body ?? ""));
        return new Response("{\"ok\":true}", { status: 200 });
      },
    });
    assert.deepEqual(bodies, ["{\"version\":2}"]);
    const rows = db.prepare("SELECT id, sent_at, last_error FROM serpix_outbox ORDER BY created_at").all() as Array<{
      id: string;
      sent_at: number;
      last_error: string | null;
    }>;
    assert.equal(rows[0]?.id, "old");
    assert.equal(rows[0]?.last_error, "coalesced");
    assert.equal(rows[1]?.id, "new");
    assert.equal(rows[1]?.sent_at, 100);
    assert.equal(rows[1]?.last_error, null);
  });

  it("leaves the row pending when the secret or URL is missing", async () => {
    const db = openDb();
    insertOutbox(db, { id: "o1", created: 1, payload: "{}" });
    let fetches = 0;
    await flushOutbox(envFor(db, [], { CUENTIX_SYNC_SECRET: undefined }), ["o1"], {
      now: 1,
      fetchImpl: async () => {
        fetches += 1;
        return new Response("ok", { status: 200 });
      },
    });
    await flushOutbox(envFor(db, [], { SERPIX_SYNC_URL: undefined }), ["o1"], {
      now: 1,
      fetchImpl: async () => {
        fetches += 1;
        return new Response("ok", { status: 200 });
      },
    });
    const row = db.prepare("SELECT sent_at, failed_at FROM serpix_outbox WHERE id = 'o1'").get() as {
      sent_at: number | null;
      failed_at: number | null;
    };
    assert.equal(fetches, 0);
    assert.equal(row.sent_at, null);
    assert.equal(row.failed_at, null);
  });

  it("enqueue returns a prepared insert the caller can batch", () => {
    const db = openDb();
    const log: LogEntry[] = [];
    const env = envFor(db, log);
    const [stmt] = enqueueOutboxStatements(env.DB, {
      id: "o1",
      txId: "t1",
      eventId: "e1",
      type: "delete",
      payload: buildDeletePayload({ eventId: "e1", sourceId: "t1", version: 3 }),
      createdAt: 9,
    });
    assert.ok(stmt);
    assert.equal(log.length, 0);
  });
});

describe("mark path", () => {
  it("batches exactly two statements and does not await the push", async () => {
    const db = openDb();
    seedTx(db);
    const log: LogEntry[] = [];
    const env = envFor(db, log);
    const ctx = ctxOf();
    let fetchStarted = false;
    let release: (value: Response) => void = () => {};
    const fetchMock = installFetch(
      () =>
        new Promise<Response>((resolve) => {
          fetchStarted = true;
          release = resolve;
        }),
    );
    try {
      const res = await Promise.race([
        handleTransactions(patch({ id: "t1", isBusiness: true }), env, user, ctx),
        new Promise<Response>((_, reject) => {
          setTimeout(() => reject(new Error("mark awaited the network")), 400);
        }),
      ]);
      assert.equal(res.status, 200);
      const batchAt = log.findIndex((entry) => entry.kind === "batch");
      assert.equal(batchAt, 2);
      const batch = log[batchAt];
      assert.equal(batch?.kind, "batch");
      if (batch?.kind !== "batch") return;
      assert.equal(batch.sqls.length, 2);
      assert.match(batch.sqls[0] ?? "", /UPDATE transactions/);
      assert.match(batch.sqls[1] ?? "", /INSERT INTO serpix_outbox/);
      assert.equal(log.slice(0, batchAt).every((entry) => entry.kind !== "run"), true);
      const pending = db.prepare("SELECT is_business, business_version FROM transactions WHERE id = 't1'").get() as {
        is_business: number;
        business_version: number;
      };
      const out = db.prepare("SELECT sent_at, payload FROM serpix_outbox").get() as {
        sent_at: number | null;
        payload: string;
      };
      assert.equal(pending.is_business, 1);
      assert.equal(out.sent_at, null);
      assert.match(out.payload, /"amount_minor":1696125/);
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(fetchStarted, true);
      assert.equal(
        (db.prepare("SELECT sent_at FROM serpix_outbox").get() as { sent_at: number | null }).sent_at,
        null,
      );
      release(new Response("{\"ok\":true}", { status: 200 }));
      await Promise.all(ctx.pending);
      assert.equal(
        (db.prepare("SELECT sent_at FROM serpix_outbox").get() as { sent_at: number | null }).sent_at == null,
        false,
      );
    } finally {
      fetchMock.restore();
    }
  });

  it("marks, edits and unmarks with signed events", async () => {
    const db = openDb();
    seedTx(db, { credit: 0 });
    const log: LogEntry[] = [];
    const env = envFor(db, log);
    const ctx = ctxOf();
    const seen: Captured[] = [];
    const fetchMock = installFetch((call) => {
      seen.push(call);
      return new Response("{\"ok\":true,\"applied\":true}", { status: 200 });
    });
    try {
      const marked = await handleTransactions(patch({ id: "t1", isBusiness: true }), env, user, ctx);
      assert.equal(marked.status, 200);
      await Promise.all(ctx.pending.splice(0));
      assert.equal(seen.length, 1);
      const first = JSON.parse(seen[0]!.body) as {
        type: string;
        kind: string;
        currency: string;
        amount_minor: number;
        version: number;
        category: string;
        event_id: string;
      };
      assert.equal(first.type, "upsert");
      assert.equal(first.kind, "expense");
      assert.equal(first.currency, "ARS");
      assert.equal(first.amount_minor, 1_696_125);
      assert.equal(first.category, "Supermercado");
      const timestamp = seen[0]!.headers.get("X-Sync-Timestamp") ?? "";
      const nonce = seen[0]!.headers.get("X-Sync-Nonce") ?? "";
      assert.equal(nonce.length, 32);
      assert.equal(
        seen[0]!.headers.get("X-Sync-Signature"),
        await signSyncBody("test-secret-not-real", timestamp, nonce, seen[0]!.body),
      );

      const edited = await handleTransactions(
        patch({ id: "t1", amountArs: "0.29", description: "DIA centro" }),
        env,
        user,
        ctx,
      );
      assert.equal(edited.status, 200);
      await Promise.all(ctx.pending.splice(0));
      const second = JSON.parse(seen[1]!.body) as {
        type: string;
        version: number;
        amount_minor: number;
        description: string;
        event_id: string;
      };
      assert.equal(second.type, "upsert");
      assert.equal(second.amount_minor, 29);
      assert.equal(second.description, "DIA centro");
      assert.ok(second.version > first.version);
      assert.notEqual(second.event_id, first.event_id);
      assert.notEqual(seen[1]!.headers.get("X-Sync-Nonce"), nonce);

      const unmarked = await handleTransactions(patch({ id: "t1", isBusiness: false }), env, user, ctx);
      assert.equal(unmarked.status, 200);
      await Promise.all(ctx.pending.splice(0));
      const third = JSON.parse(seen[2]!.body) as { type: string; version: number };
      assert.equal(third.type, "delete");
      assert.deepEqual(Object.keys(JSON.parse(seen[2]!.body)), [
        "v",
        "event_id",
        "type",
        "source",
        "source_id",
        "version",
      ]);
      assert.ok(third.version > second.version);
      const tx = db.prepare("SELECT is_business FROM transactions WHERE id = 't1'").get() as {
        is_business: number;
      };
      assert.equal(tx.is_business, 0);
    } finally {
      fetchMock.restore();
    }
  });

  it("rejects card payments and keeps a missing secret pending", async () => {
    const db = openDb();
    seedTx(db, { payment: 1, ars: "10.00" });
    const env = envFor(db, []);
    const denied = await handleTransactions(patch({ id: "t1", isBusiness: true }), env, user, ctxOf());
    assert.equal(denied.status, 400);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM serpix_outbox").get() as { n: number }).n,
      0,
    );

    const shared = openDb();
    seedTx(shared, { ownership: "shared", fingerprint: "fp-shared" });
    const sharedDenied = await handleTransactions(
      patch({ id: "t1", isBusiness: true }),
      envFor(shared, []),
      user,
      ctxOf(),
    );
    assert.equal(sharedDenied.status, 400);

    const quiet = openDb();
    seedTx(quiet, { fingerprint: "fp-quiet" });
    let fetches = 0;
    const fetchMock = installFetch(() => {
      fetches += 1;
      return new Response("ok", { status: 200 });
    });
    try {
      const ctx = ctxOf();
      const res = await handleTransactions(
        patch({ id: "t1", isBusiness: true }),
        envFor(quiet, [], { CUENTIX_SYNC_SECRET: undefined, SERPIX_SYNC_URL: undefined }),
        user,
        ctx,
      );
      assert.equal(res.status, 200);
      await Promise.all(ctx.pending);
      const row = quiet.prepare("SELECT is_business FROM transactions WHERE id = 't1'").get() as {
        is_business: number;
      };
      const out = quiet.prepare("SELECT sent_at, failed_at FROM serpix_outbox").get() as {
        sent_at: number | null;
        failed_at: number | null;
      };
      assert.equal(row.is_business, 1);
      assert.equal(out.sent_at, null);
      assert.equal(out.failed_at, null);
      assert.equal(fetches, 0);
    } finally {
      fetchMock.restore();
    }
  });

  it("lists isBusiness and sync status with a single outbox join", async () => {
    const db = openDb();
    seedTx(db);
    db.prepare(
      `INSERT INTO transactions (
         id, household_id, date, description_raw, description_normalized,
         amount_ars, is_payment, is_credit, ownership, paid_by_user_id,
         external_fingerprint, source
       ) VALUES ('t2', 'h1', '2026-01-16', 'OTRO', 'OTRO', '5.00', 0, 0, 'personal', 'u1', 'fp2', 'manual')`,
    ).run();
    const log: LogEntry[] = [];
    const env = envFor(db, log);
    const ctx = ctxOf();
    const fetchMock = installFetch(() => new Response("{\"ok\":true}", { status: 200 }));
    try {
      await handleTransactions(patch({ id: "t1", isBusiness: true }), env, user, ctx);
      await Promise.all(ctx.pending.splice(0));
      log.length = 0;
      const res = await handleTransactions(
        new Request("https://cuentix.test/api/transactions?limit=10"),
        env,
        user,
      );
      assert.equal(res.status, 200);
      const data = (await res.json()) as {
        transactions: Array<{ id: string; isBusiness: boolean; syncStatus: string | null }>;
      };
      const first = data.transactions.find((row) => row.id === "t1");
      const second = data.transactions.find((row) => row.id === "t2");
      assert.equal(first?.isBusiness, true);
      assert.equal(first?.syncStatus, "sent");
      assert.equal(second?.isBusiness, false);
      assert.equal(second?.syncStatus, null);
      const outboxSql = log.filter((entry) => entry.kind !== "batch" && entry.sql.includes("serpix_outbox"));
      assert.equal(outboxSql.length, 1);
    } finally {
      fetchMock.restore();
    }
  });

  it("credit movements sync as income and USD-only rows use USD", async () => {
    const db = openDb();
    seedTx(db, { credit: 1, ars: null, usd: "10.50" });
    const env = envFor(db, []);
    const ctx = ctxOf();
    const seen: string[] = [];
    const fetchMock = installFetch((_call) => {
      seen.push(_call.body);
      return new Response("{\"ok\":true}", { status: 200 });
    });
    try {
      const res = await handleTransactions(patch({ id: "t1", isBusiness: true }), env, user, ctx);
      assert.equal(res.status, 200);
      await Promise.all(ctx.pending);
      const body = JSON.parse(seen[0] ?? "{}") as { kind: string; currency: string; amount_minor: number };
      assert.equal(body.kind, "income");
      assert.equal(body.currency, "USD");
      assert.equal(body.amount_minor, 1050);
    } finally {
      fetchMock.restore();
    }
  });
});

describe("worker cron", () => {
  it("scheduled flushes without a user request", async () => {
    const db = openDb();
    const log: LogEntry[] = [];
    const env = envFor(db, log);
    let fetches = 0;
    const fetchMock = installFetch(() => {
      fetches += 1;
      return new Response("ok", { status: 200 });
    });
    try {
      await worker.scheduled({}, env, { waitUntil() {} });
      assert.equal(fetches, 0);
      assert.ok(log.some((entry) => entry.kind !== "batch" && entry.sql.includes("serpix_outbox")));
    } finally {
      fetchMock.restore();
    }
  });

  it("prod cron is every 10 minutes and the secret stays out of config", () => {
    const prod = JSON.parse(readFileSync(join(root, "wrangler.jsonc"), "utf8")) as {
      triggers?: { crons?: string[] };
      vars?: Record<string, string>;
    };
    const staging = JSON.parse(readFileSync(join(root, "wrangler.staging.jsonc"), "utf8")) as {
      triggers?: { crons?: string[] };
      vars?: Record<string, string>;
    };
    assert.deepEqual(prod.triggers?.crons, ["*/10 * * * *"]);
    assert.equal(
      prod.vars?.SERPIX_SYNC_URL,
      "https://erp.lulox.com.ar/api/integrations/cuentix/events",
    );
    assert.equal(prod.vars?.CUENTIX_SYNC_SECRET, undefined);
    assert.equal(staging.triggers, undefined);
    assert.equal(
      staging.vars?.SERPIX_SYNC_URL,
      "https://erp.lulox.com.ar/api/integrations/cuentix/events",
    );
  });
});
