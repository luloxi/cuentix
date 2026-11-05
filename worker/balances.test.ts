import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { SessionUser } from "./auth";
import { handleBalancesGet, handleBalancesManual, handleBalancesRoutine } from "./balances";
import type { Env } from "./env";
import worker from "./index";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const user: SessionUser = { id: "user-a", email: "a@example.com", name: "Ana", image: null };
const TOKEN = "test-balances-token";

type Bound = {
  _sql: string;
  _params: () => unknown[];
  bind(...values: unknown[]): Bound;
  all(): Promise<{ results: Record<string, unknown>[] }>;
  first(): Promise<Record<string, unknown> | null>;
  run(): Promise<{ meta: { changes: number } }>;
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
    "0009_balance_snapshots.sql",
  ]) {
    db.exec(readFileSync(join(root, "migrations", file), "utf8"));
  }
  return db;
}

function wrap(db: DatabaseSync): Env["DB"] {
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
          return { results: db.prepare(sql).all(...params) as Record<string, unknown>[] };
        },
        async first() {
          return (db.prepare(sql).get(...params) as Record<string, unknown> | undefined) ?? null;
        },
        async run() {
          const info = db.prepare(sql).run(...params) as { changes?: number };
          return { meta: { changes: Number(info.changes ?? 0) } };
        },
      };
      return stmt;
    },
    async batch(statements: Bound[]) {
      db.exec("BEGIN");
      try {
        const results = statements.map((statement) => {
          const info = db.prepare(statement._sql).run(...statement._params()) as { changes?: number };
          return { meta: { changes: Number(info.changes ?? 0) } };
        });
        db.exec("COMMIT");
        return results;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  } as Env["DB"];
}

function envFor(db: DatabaseSync): Env {
  return {
    DB: wrap(db),
    RECEIPTS: { put: async () => null, get: async () => null },
    AI: { toMarkdown: async () => null },
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    BALANCES_TOKEN: TOKEN,
    BALANCES_USER_EMAIL: "a@example.com",
  };
}

function seed(db: DatabaseSync) {
  db.prepare("INSERT INTO users (id, email, name) VALUES ('user-a', 'a@example.com', 'Ana')").run();
  db.prepare("INSERT INTO households (id, name, invite_code) VALUES ('h1', 'Personal', 'CODE0001')").run();
  db.prepare("INSERT INTO households (id, name, invite_code) VALUES ('h2', 'Casa', 'CODE0002')").run();
  db.prepare(
    "INSERT INTO household_members (household_id, user_id, role) VALUES ('h1', 'user-a', 'owner')",
  ).run();
  db.prepare(
    "INSERT INTO household_members (household_id, user_id, role) VALUES ('h2', 'user-a', 'owner')",
  ).run();
}

describe("balance snapshots", () => {
  it("rejects a missing or wrong bearer and ignores the session cookie", async () => {
    const db = openDb();
    seed(db);
    const env = envFor(db);
    const missing = await worker.fetch(
      new Request("https://tarask.test/api/balances", {
        method: "POST",
        headers: { cookie: "tarask_session=not-a-session", "content-type": "application/json" },
        body: JSON.stringify({
          snapshots: [{ account: "Fiwind", currency: "USDT", amount: 1 }],
        }),
      }),
      env,
    );
    assert.equal(missing.status, 401);

    const wrong = await handleBalancesRoutine(
      new Request("https://tarask.test/api/balances", {
        method: "POST",
        headers: { authorization: "Bearer nope", "content-type": "application/json" },
        body: JSON.stringify({ snapshots: [{ account: "Fiwind", currency: "USDT", amount: 1 }] }),
      }),
      env,
    );
    assert.equal(wrong.status, 401);
    const count = db.prepare("SELECT COUNT(*) AS n FROM balance_snapshots").get() as { n: number };
    assert.equal(count.n, 0);
  });

  it("upserts per account and currency and does not add them together", async () => {
    const db = openDb();
    seed(db);
    const env = envFor(db);
    const first = await handleBalancesRoutine(
      new Request("https://tarask.test/api/balances", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({
          source: "routine",
          snapshots: [
            { account: "Fiwind", currency: "USDT", amount: 10.5, date: "2026-11-03" },
            { account: "Fiwind", currency: "ARS", amount: 100, date: "2026-11-03" },
            { account: "BBVA", currency: "USD", amount: 20, date: "2026-11-03" },
          ],
        }),
      }),
      env,
    );
    assert.equal(first.status, 200);
    const again = await handleBalancesRoutine(
      new Request("https://tarask.test/api/balances", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({
          snapshots: [{ account: "Fiwind", currency: "USDT", amount: 12, date: "2026-11-03" }],
        }),
      }),
      env,
    );
    assert.equal(again.status, 200);
    const rows = db
      .prepare("SELECT account_name, currency, amount, source FROM balance_snapshots ORDER BY currency")
      .all() as Array<{ account_name: string; currency: string; amount: string; source: string }>;
    assert.equal(rows.length, 3);
    assert.equal(rows.find((row) => row.currency === "USDT")?.amount, "12");
    assert.equal(rows.find((row) => row.currency === "USDT")?.source, "routine");

    const manual = await handleBalancesManual(
      new Request("https://tarask.test/api/balances/manual", {
        method: "POST",
        headers: { cookie: "lc_household=h1", "content-type": "application/json" },
        body: JSON.stringify({ account: "Brubank", currency: "ARS", amount: 50, date: "2026-11-04" }),
      }),
      env,
      user,
    );
    assert.equal(manual.status, 200);

    const listed = await handleBalancesGet(
      new Request("https://tarask.test/api/balances?currency=USDT", {
        headers: { cookie: "lc_household=h1" },
      }),
      env,
      user,
    );
    assert.equal(listed.headers.get("cache-control"), "private, max-age=30");
    const body = (await listed.json()) as {
      totals: Array<{ currency: string; total: number }>;
      latest: Array<{ account: string; currency: string; amount: number }>;
    };
    const byCurrency = Object.fromEntries(body.totals.map((row) => [row.currency, row.total]));
    assert.equal(byCurrency.USDT, 12);
    assert.equal(byCurrency.ARS, 150);
    assert.equal(byCurrency.USD, 20);
    assert.equal(body.totals.some((row) => row.currency === "ALL"), false);
    assert.ok(body.latest.some((row) => row.account === "Brubank" && row.currency === "ARS"));
  });
});
