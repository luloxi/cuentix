import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { similarDescriptionVariants } from "../src/lib/fiwind-similar";
import type { SessionUser } from "./auth";
import type { Env } from "./env";
import { sha256Hex } from "./http";
import worker from "./index";
import { handleFiwindReclassify } from "./reclassify";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const user: SessionUser = { id: "u1", email: "a@b.co", name: "Ana", image: null };
const other: SessionUser = { id: "u9", email: "x@y.co", name: "Nadie", image: null };

type Logged = { sql: string; params: unknown[] };
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
  for (const file of [
    "0001_app.sql",
    "0002_auth.sql",
    "0003_serpix_sync.sql",
    "0004_card_closed.sql",
    "0005_patrimonio_snapshots.sql",
    "0006_patrimonio_user_date.sql",
    "0007_perf_indexes.sql",
    "0008_tx_household_desc_idx.sql",
  ]) {
    db.exec(readFileSync(join(root, "migrations", file), "utf8"));
  }
  db.prepare("INSERT INTO users (id, email, name) VALUES ('u1', 'a@b.co', 'Ana')").run();
  db.prepare("INSERT INTO users (id, email, name) VALUES ('u2', 'b@b.co', 'Beto')").run();
  db.prepare("INSERT INTO households (id, name, invite_code) VALUES ('h1', 'Personal', 'CODE0001')").run();
  db.prepare("INSERT INTO households (id, name, invite_code) VALUES ('h2', 'Casa', 'CODE0002')").run();
  db.prepare(
    "INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES ('h1', 'u1', 'owner', 1)",
  ).run();
  db.prepare(
    "INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES ('h1', 'u2', 'member', 2)",
  ).run();
  db.prepare(
    "INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES ('h2', 'u1', 'owner', 3)",
  ).run();
  const insertCat = db.prepare(
    "INSERT INTO categories (id, slug, name, kind, is_system, household_id) VALUES (?, ?, ?, 'expense', ?, ?)",
  );
  insertCat.run("c-old", "uncategorized", "Sin categoría", 1, null);
  insertCat.run("c-new", "supermercado", "Supermercado", 1, null);
  insertCat.run("c-hide", "oculta", "Oculta", 1, null);
  insertCat.run("c-h1", "propia", "Propia", 0, "h1");
  insertCat.run("c-h2", "solo-h2", "Solo otro", 0, "h2");
  db.prepare(
    "INSERT INTO household_category_prefs (household_id, category_id, hidden) VALUES ('h1', 'c-hide', 1)",
  ).run();
  return db;
}

function wrap(db: DatabaseSync, log: Logged[]) {
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
          log.push({ sql, params: [...params] });
          return { results: db.prepare(sql).all(...(params as never[])) as Record<string, unknown>[] };
        },
        async first() {
          log.push({ sql, params: [...params] });
          return (db.prepare(sql).get(...(params as never[])) as Record<string, unknown> | undefined) ?? null;
        },
        async run() {
          log.push({ sql, params: [...params] });
          const info = db.prepare(sql).run(...(params as never[])) as { changes?: number };
          return { meta: { changes: Number(info.changes ?? 0) } };
        },
      };
      return stmt;
    },
    async batch(statements: Bound[]) {
      db.exec("BEGIN");
      try {
        const results = statements.map((statement) => {
          const params = statement._params();
          log.push({ sql: statement._sql, params: [...params] });
          const info = db.prepare(statement._sql).run(...(params as never[])) as { changes?: number };
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

function envFor(db: DatabaseSync, log: Logged[] = []): Env {
  return {
    DB: wrap(db, log) as unknown as Env["DB"],
    RECEIPTS: { put: async () => null, get: async () => null },
    AI: { toMarkdown: async () => null },
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
  };
}

function insertTx(
  db: DatabaseSync,
  row: {
    id: string;
    description: string;
    date?: string;
    householdId?: string;
    bank?: string;
    categoryId?: string;
    ownership?: string;
    paidBy?: string | null;
    isBusiness?: number;
    amountArs?: string | null;
    amountUsd?: string | null;
  },
) {
  db.prepare(
    `INSERT INTO transactions (
       id, household_id, date, description_raw, description_normalized,
       amount_ars, amount_usd, category_id, ownership, paid_by_user_id,
       external_fingerprint, source, bank, is_business, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fiwind', ?, ?, 1, 1)`,
  ).run(
    row.id,
    row.householdId ?? "h1",
    row.date ?? "2026-08-10",
    row.description,
    row.description,
    row.amountArs === undefined ? "1500.50" : row.amountArs,
    row.amountUsd ?? null,
    row.categoryId ?? "c-old",
    row.ownership ?? "shared",
    row.paidBy === undefined ? "u1" : row.paidBy,
    `fp-${row.id}`,
    row.bank ?? "Fiwind",
    row.isBusiness ?? 0,
  );
}

function categoryOf(db: DatabaseSync, id: string): string | null {
  const row = db.prepare("SELECT category_id AS category_id FROM transactions WHERE id = ?").get(id) as
    | { category_id: string | null }
    | undefined;
  return row?.category_id ?? null;
}

function request(path: string, cookie = "lc_household=h1", init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("cookie", cookie);
  return new Request(`https://cuentix.test${path}`, { ...init, headers });
}

function post(body: unknown, cookie = "lc_household=h1"): Request {
  return request("/api/fiwind/reclassify", cookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function seedWorld(db: DatabaseSync) {
  insertTx(db, { id: "target", description: "Pago a Día", date: "2026-08-18", amountArs: "2500.00" });
  insertTx(db, { id: "cargo", description: "Cargo extra de DIA", date: "2026-07-02" });
  insertTx(db, { id: "pago", description: "Pago a DIA", date: "2026-08-09", ownership: "personal" });
  insertTx(db, {
    id: "personal-other",
    description: "Pago a DIA",
    date: "2026-08-11",
    ownership: "personal",
    paidBy: "u2",
  });
  insertTx(db, { id: "upper", description: "PAGO A DIA", date: "2026-08-12" });
  insertTx(db, { id: "plain-dev", description: "Devolucion de DIA", date: "2026-08-13" });
  insertTx(db, { id: "retiro", description: "Retiro a DIA", date: "2026-08-14" });
  insertTx(db, { id: "accent-cargo", description: "Cargo extra de Día", date: "2026-08-08" });
  insertTx(db, { id: "diageo", description: "Pago a DIAGEO", date: "2026-08-15" });
  insertTx(db, { id: "tienda", description: "Pago a DIA TIENDA", date: "2026-08-16" });
  insertTx(db, { id: "bbva", description: "Pago a DIA", date: "2026-08-17", bank: "BBVA" });
  insertTx(db, { id: "other-home", description: "Pago a DIA", date: "2026-08-17", householdId: "h2" });
  insertTx(db, { id: "biz", description: "Pago a DIA", date: "2026-08-19", isBusiness: 1 });
  insertTx(db, {
    id: "h2-shared",
    description: "Pago a YPF",
    date: "2026-08-04",
    householdId: "h2",
  });
  insertTx(db, {
    id: "h2-own",
    description: "Pago a Farmacity",
    date: "2026-08-05",
    householdId: "h2",
    ownership: "personal",
  });
  insertTx(db, { id: "usd", description: "Pago a Spotify", date: "2026-08-01", amountArs: null, amountUsd: "9.99" });
}

describe("fiwind reclassify", () => {
  it("requires a YYYY-MM period", async () => {
    const db = openDb();
    const env = envFor(db);
    for (const path of [
      "/api/fiwind/movements",
      "/api/fiwind/movements?period=",
      "/api/fiwind/movements?period=2026-13",
      "/api/fiwind/movements?period=2026-8",
      "/api/fiwind/movements?period=agosto",
    ]) {
      const res = await handleFiwindReclassify(request(path), env, user);
      assert.equal(res.status, 400, path);
    }
    const stranger = await handleFiwindReclassify(
      request("/api/fiwind/movements?period=2026-08"),
      env,
      other,
    );
    assert.equal(stranger.status, 400);
    const body = (await stranger.json()) as { error: string };
    assert.equal(body.error, "NO_HOUSEHOLD");
  });

  it("lists one month of visible Fiwind rows and the categories", async () => {
    const db = openDb();
    seedWorld(db);
    const log: Logged[] = [];
    const env = envFor(db, log);
    const res = await handleFiwindReclassify(
      request("/api/fiwind/movements?period=2026-08&limit=1000&offset=0"),
      env,
      user,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      limit: number;
      movements: Array<{
        id: string;
        date: string;
        description: string;
        amountArs: number | null;
        amountUsd: number | null;
        category: { id: string; slug: string; name: string } | null;
        isBusiness: boolean;
      }>;
      categories: Array<{ id: string; slug: string }>;
    };
    assert.equal(body.limit, 100);
    const ids = body.movements.map((row) => row.id);
    assert.deepEqual(ids, [
      "biz",
      "target",
      "tienda",
      "diageo",
      "retiro",
      "plain-dev",
      "upper",
      "pago",
      "accent-cargo",
      "usd",
    ]);
    assert.equal(ids.includes("cargo"), false);
    assert.equal(ids.includes("personal-other"), false);
    assert.equal(ids.includes("bbva"), false);
    assert.equal(ids.includes("other-home"), false);
    assert.equal(ids.includes("h2-shared"), false);
    const target = body.movements.find((row) => row.id === "target");
    assert.equal(target?.description, "Pago a Día");
    assert.equal(target?.amountArs, 2500);
    assert.equal(target?.amountUsd, null);
    assert.equal(target?.category?.slug, "uncategorized");
    assert.equal(target?.category?.name, "Sin categoría");
    const usd = body.movements.find((row) => row.id === "usd");
    assert.equal(usd?.amountArs, null);
    assert.equal(usd?.amountUsd, 9.99);
    assert.equal(body.movements.find((row) => row.id === "biz")?.isBusiness, true);
    assert.equal(body.categories.some((row) => row.slug === "supermercado"), true);
    assert.equal(body.categories.some((row) => row.slug === "oculta"), false);
    assert.equal(body.categories.some((row) => row.slug === "solo-h2"), false);
    assert.equal(body.categories.some((row) => row.id === "c-h1"), true);

    const page = await handleFiwindReclassify(
      request("/api/fiwind/movements?period=2026-08&limit=1&offset=1"),
      env,
      user,
    );
    const pageBody = (await page.json()) as { movements: Array<{ id: string }> };
    assert.deepEqual(pageBody.movements.map((row) => row.id), ["target"]);

    const july = await handleFiwindReclassify(request("/api/fiwind/movements?period=2026-07"), env, user);
    const julyBody = (await july.json()) as { movements: Array<{ id: string }> };
    assert.deepEqual(julyBody.movements.map((row) => row.id), ["cargo"]);

    const casa = await handleFiwindReclassify(
      request("/api/fiwind/movements?period=2026-08", "lc_household=h2"),
      env,
      user,
    );
    const casaBody = (await casa.json()) as { movements: Array<{ id: string }> };
    assert.deepEqual(
      casaBody.movements.map((row) => row.id).sort(),
      ["h2-shared", "other-home"].sort(),
    );
    assertPlans(db, log);
  });

  it("counts other Fiwind rows with the same counterparty and skips business", async () => {
    const db = openDb();
    seedWorld(db);
    const env = envFor(db);
    const res = await handleFiwindReclassify(request("/api/fiwind/similar?id=target"), env, user);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      key: string;
      variants: string[];
      count: number;
      capped: boolean;
      skippedBusiness: number;
    };
    const variants = similarDescriptionVariants("Pago a Día");
    assert.equal(body.key, "DIA");
    assert.deepEqual(body.variants, variants);
    assert.equal(body.capped, false);
    const expected = ["cargo", "pago", "personal-other", "upper", "plain-dev", "retiro", "accent-cargo"].filter(
      (id) => variants.includes(descriptionOf(db, id)),
    ).length;
    assert.equal(body.count, expected);
    assert.ok(body.count >= 1);
    assert.equal(body.skippedBusiness, variants.includes("Pago a DIA") ? 1 : 0);

    const missing = await handleFiwindReclassify(request("/api/fiwind/similar?id=nope"), env, user);
    assert.equal(missing.status, 404);
    const bbva = await handleFiwindReclassify(request("/api/fiwind/similar?id=bbva"), env, user);
    assert.equal(bbva.status, 404);
    const foreign = await handleFiwindReclassify(request("/api/fiwind/similar?id=other-home"), env, user);
    assert.equal(foreign.status, 404);
    const hidden = await handleFiwindReclassify(request("/api/fiwind/similar?id=personal-other"), env, user);
    assert.equal(hidden.status, 403);
    const noId = await handleFiwindReclassify(request("/api/fiwind/similar"), env, user);
    assert.equal(noId.status, 400);
  });

  it("updates only the chosen row unless applyToSimilar is set", async () => {
    const db = openDb();
    seedWorld(db);
    const env = envFor(db);
    const alone = await handleFiwindReclassify(
      post({ id: "target", categoryId: "c-new", applyToSimilar: false }),
      env,
      user,
    );
    assert.equal(alone.status, 200);
    const aloneBody = (await alone.json()) as { ok: boolean; updated: number; similarUpdated: number };
    assert.deepEqual(aloneBody, { ok: true, updated: 1, similarUpdated: 0 });
    assert.equal(categoryOf(db, "target"), "c-new");
    for (const id of ["cargo", "pago", "diageo", "bbva", "other-home", "biz", "tienda"]) {
      assert.equal(categoryOf(db, id), "c-old", id);
    }
    const rules = db.prepare("SELECT COUNT(*) AS n FROM merchant_rules").get() as { n: number };
    assert.equal(rules.n, 0);

    db.prepare("UPDATE transactions SET category_id = 'c-old', updated_at = 1 WHERE id = 'target'").run();
    const variants = similarDescriptionVariants("Pago a Día");
    const applied = await handleFiwindReclassify(
      post({ id: "target", categoryId: "c-h1", applyToSimilar: true, expectedCount: countExpected(db, variants) }),
      env,
      user,
    );
    assert.equal(applied.status, 200);
    const appliedBody = (await applied.json()) as { updated: number; similarUpdated: number };
    assert.equal(appliedBody.updated, 1);
    assert.equal(appliedBody.similarUpdated, countExpected(db, variants));
    assert.equal(categoryOf(db, "target"), "c-h1");
    for (const id of ["cargo", "pago", "personal-other", "upper", "plain-dev", "retiro", "accent-cargo", "diageo", "tienda", "bbva", "other-home", "biz"]) {
      const household = id === "other-home" ? "h2" : "h1";
      const bank = id === "bbva" ? "BBVA" : "Fiwind";
      const business = id === "biz";
      const expected =
        household === "h1" && bank === "Fiwind" && !business && variants.includes(descriptionOf(db, id))
          ? "c-h1"
          : "c-old";
      assert.equal(categoryOf(db, id), expected, id);
    }
    const total = db.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number };
    assert.equal(total.n, 16);
  });

  it("returns 409 when expectedCount does not match and writes nothing", async () => {
    const db = openDb();
    seedWorld(db);
    const env = envFor(db);
    const variants = similarDescriptionVariants("Pago a Día");
    const live = countExpected(db, variants);
    const res = await handleFiwindReclassify(
      post({ id: "target", categoryId: "c-new", applyToSimilar: true, expectedCount: live + 1 }),
      env,
      user,
    );
    assert.equal(res.status, 409);
    const body = (await res.json()) as { count: number; capped: boolean; error: string };
    assert.equal(body.count, live);
    assert.equal(body.capped, false);
    assert.match(body.error, /Confirmá/);
    for (const id of ["target", "cargo", "pago", "diageo", "biz"]) {
      assert.equal(categoryOf(db, id), "c-old", id);
    }

    const bad = await handleFiwindReclassify(
      post({ id: "target", categoryId: "c-new", applyToSimilar: true, expectedCount: -1 }),
      env,
      user,
    );
    assert.equal(bad.status, 400);
    const fractional = await handleFiwindReclassify(
      post({ id: "target", categoryId: "c-new", applyToSimilar: true, expectedCount: 1.5 }),
      env,
      user,
    );
    assert.equal(fractional.status, 400);
  });

  it("rejects an invalid category, a business row, and rows the user cannot see", async () => {
    const db = openDb();
    seedWorld(db);
    const env = envFor(db);
    for (const categoryId of ["c-hide", "c-h2", "missing", ""]) {
      const res = await handleFiwindReclassify(post({ id: "target", categoryId }), env, user);
      assert.equal(res.status, 400, categoryId);
      assert.equal(categoryOf(db, "target"), "c-old");
    }
    const business = await handleFiwindReclassify(post({ id: "biz", categoryId: "c-new" }), env, user);
    assert.equal(business.status, 409);
    const businessBody = (await business.json()) as { code: string };
    assert.equal(businessBody.code, "business");
    assert.equal(categoryOf(db, "biz"), "c-old");
    const hidden = await handleFiwindReclassify(
      post({ id: "personal-other", categoryId: "c-new" }),
      env,
      user,
    );
    assert.equal(hidden.status, 403);
    assert.equal(categoryOf(db, "personal-other"), "c-old");
    const missing = await handleFiwindReclassify(post({ categoryId: "c-new" }), env, user);
    assert.equal(missing.status, 400);
  });

  it("caps the similar update at 500 and conflicts when the confirmed number is stale", async () => {
    const db = openDb();
    const env = envFor(db);
    insertTx(db, { id: "cap-target", description: "Pago a DIA", date: "2026-08-02" });
    for (let i = 0; i < 501; i += 1) {
      insertTx(db, { id: `cap-${i}`, description: "Pago a DIA", date: "2026-01-15" });
    }
    const preview = await handleFiwindReclassify(request("/api/fiwind/similar?id=cap-target"), env, user);
    const previewBody = (await preview.json()) as { count: number; capped: boolean };
    assert.equal(preview.status, 200);
    assert.equal(previewBody.count, 500);
    assert.equal(previewBody.capped, true);

    const stale = await handleFiwindReclassify(
      post({ id: "cap-target", categoryId: "c-new", applyToSimilar: true, expectedCount: 499 }),
      env,
      user,
    );
    assert.equal(stale.status, 409);
    const staleBody = (await stale.json()) as { count: number; capped: boolean };
    assert.equal(staleBody.count, 500);
    assert.equal(staleBody.capped, true);
    assert.equal(categoryOf(db, "cap-target"), "c-old");
    assert.equal(categoryOf(db, "cap-0"), "c-old");

    const ok = await handleFiwindReclassify(
      post({ id: "cap-target", categoryId: "c-new", applyToSimilar: true, expectedCount: 500 }),
      env,
      user,
    );
    assert.equal(ok.status, 200);
    const okBody = (await ok.json()) as { updated: number; similarUpdated: number };
    assert.equal(okBody.updated, 1);
    assert.equal(okBody.similarUpdated, 500);
    const totals = db
      .prepare(
        `SELECT
           SUM(CASE WHEN category_id = 'c-new' THEN 1 ELSE 0 END) AS neu,
           SUM(CASE WHEN category_id = 'c-old' THEN 1 ELSE 0 END) AS old
         FROM transactions`,
      )
      .get() as { neu: number; old: number };
    assert.equal(Number(totals.neu), 501);
    assert.equal(Number(totals.old), 1);
    assert.equal(categoryOf(db, "cap-target"), "c-new");
    const still = db.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number };
    assert.equal(still.n, 502);
  });

  it("rejects anonymous calls and serves the route for a session", async () => {
    const db = openDb();
    insertTx(db, { id: "one", description: "Pago a DIA" });
    const env = envFor(db);
    for (const path of ["/api/fiwind/movements?period=2026-08", "/api/fiwind/similar?id=one", "/api/fiwind/reclassify"]) {
      const res = await worker.fetch(new Request(`https://cuentix.test${path}`), env);
      assert.equal(res.status, 401, path);
    }
    const token = "session-token";
    const hash = await sha256Hex(token);
    db.prepare("INSERT INTO auth_user (id, name, email) VALUES ('u1', 'Ana', 'a@b.co')").run();
    db.prepare(
      "INSERT INTO auth_session (id, expires_at, token, user_id) VALUES ('s1', ?, ?, 'u1')",
    ).run(Date.now() + 60_000, hash);
    const authed = await worker.fetch(
      new Request("https://cuentix.test/api/fiwind/movements?period=2026-08", {
        headers: { cookie: `cuentix_session=${encodeURIComponent(token)}; lc_household=h1` },
      }),
      env,
    );
    assert.equal(authed.status, 200);
    const body = (await authed.json()) as { movements: Array<{ id: string }> };
    assert.deepEqual(body.movements.map((row) => row.id), ["one"]);
  });
});

describe("fiwind reclassify query budget", () => {
  it("keeps every transactions statement indexed, bounded, and equality-only", () => {
    const source = readFileSync(join(root, "worker/reclassify.ts"), "utf8");
    assert.doesNotMatch(source, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(source, /\bLIKE\b/i);
    assert.doesNotMatch(source, /\bGLOB\b/i);
    assert.doesNotMatch(source, /\b(upper|lower)\s*\(/i);
    const statements = sqlTemplates(source);
    assert.ok(statements.length >= 6, `found ${statements.length}`);
    for (const sql of statements) {
      assert.match(sql, /household_id\s*=\s*\?/, sql);
      const dateRange = /date\s*>=\s*\?/.test(sql) && /date\s*<\s*\?/.test(sql);
      const descriptionIn = /description_normalized\s+IN\s*\(/.test(sql);
      const primaryKey = /\bid\s*=\s*\?/.test(sql);
      assert.ok(dateRange || descriptionIn || primaryKey, sql);
      assert.ok(/\bLIMIT\b/.test(sql) || primaryKey, sql);
      assert.equal(sql.includes("'Fiwind'"), true, sql);
    }
  });
});

function sqlTemplates(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(/`[^`]*`/g)) {
    const body = match[0].slice(1, -1);
    if (/\b(SELECT|UPDATE)\b/i.test(body) && /\btransactions\b/i.test(body)) out.push(body);
  }
  return out;
}

function descriptionOf(db: DatabaseSync, id: string): string {
  const row = db.prepare("SELECT description_normalized AS description FROM transactions WHERE id = ?").get(id) as
    | { description: string }
    | undefined;
  return row?.description ?? "";
}

function countExpected(db: DatabaseSync, variants: string[]): number {
  return ["cargo", "pago", "personal-other", "upper", "plain-dev", "retiro", "accent-cargo"].filter((id) =>
    variants.includes(descriptionOf(db, id)),
  ).length;
}

function assertPlans(db: DatabaseSync, log: Logged[]) {
  const seen = log.filter((entry) => /\btransactions\b/i.test(entry.sql));
  assert.ok(seen.length >= 3);
  for (const entry of seen) {
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${entry.sql}`).all(...(entry.params as never[])) as Array<{
      detail: string;
    }>;
    const detail = plan.map((row) => row.detail).join("\n");
    assert.doesNotMatch(detail, /SCAN (TABLE )?(t|transactions)\b/i, `${detail}\n${entry.sql}`);
    assert.match(
      detail,
      /tx_household_date_idx|tx_household_desc_idx|sqlite_autoindex_transactions_1/,
      `${detail}\n${entry.sql}`,
    );
  }
}
