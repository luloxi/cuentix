import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { SessionUser } from "./auth";
import { handleDashboard } from "./dashboard";
import type { Env } from "./env";
import { primeFxForTests } from "./fx";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const user: SessionUser = { id: "user-a", email: "a@example.com", name: "Member A", image: null };

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
  ]) {
    db.exec(readFileSync(join(root, "migrations", file), "utf8"));
  }
  return db;
}

function wrap(db: DatabaseSync, log: string[]) {
  return {
    prepare(sql: string) {
      let params: unknown[] = [];
      const stmt = {
        bind(...values: unknown[]) {
          params = values;
          return stmt;
        },
        async all() {
          log.push(sql);
          return { results: db.prepare(sql).all(...(params as never[])) as Record<string, unknown>[] };
        },
        async first() {
          log.push(sql);
          return (db.prepare(sql).get(...(params as never[])) as Record<string, unknown> | undefined) ?? null;
        },
        async run() {
          const info = db.prepare(sql).run(...(params as never[])) as { changes?: number };
          return { meta: { changes: Number(info.changes ?? 0) } };
        },
      };
      return stmt;
    },
  };
}

function envFor(db: DatabaseSync, log: string[]): Env {
  return {
    DB: wrap(db, log) as Env["DB"],
    RECEIPTS: { put: async () => null, get: async () => null },
    AI: { toMarkdown: async () => null },
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
  };
}

function seed(db: DatabaseSync) {
  db.prepare("INSERT INTO users (id, email, name) VALUES ('user-a', 'a@example.com', 'Member A')").run();
  db.prepare("INSERT INTO households (id, name, invite_code) VALUES ('h1', 'Personal', 'CODE0001')").run();
  db.prepare("INSERT INTO households (id, name, invite_code) VALUES ('h2', 'Otra', 'CODE0002')").run();
  db.prepare(
    "INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES ('h1', 'user-a', 'owner', 1)",
  ).run();
  db.prepare(
    "INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES ('h2', 'user-a', 'owner', 2)",
  ).run();
  db.prepare(
    `INSERT INTO incomes (id, user_id, household_id, date, label, kind, amount_ars)
     VALUES ('inc-h1', 'user-a', 'h1', '2026-08-10', 'Sueldo', 'variable', '500000')`,
  ).run();
  db.prepare(
    `INSERT INTO incomes (id, user_id, household_id, date, label, kind, amount_ars)
     VALUES ('inc-h2', 'user-a', 'h2', '2026-08-10', 'Sueldo', 'variable', '700000')`,
  ).run();
}

describe("dashboard income household", () => {
  it("sums income for the active household only", async () => {
    const db = openDb();
    seed(db);
    primeFxForTests({ blue: 1000 });
    const log: string[] = [];
    const home = await handleDashboard(
      new Request("https://cuentix.test/api/dashboard?period=2026-08", {
        headers: { cookie: "lc_household=h1" },
      }),
      envFor(db, log),
      user,
    );
    assert.equal(home.status, 200);
    const homeBody = (await home.json()) as { incomeArs: number };
    assert.equal(homeBody.incomeArs, 500000);

    const otherLog: string[] = [];
    const other = await handleDashboard(
      new Request("https://cuentix.test/api/dashboard?period=2026-08", {
        headers: { cookie: "lc_household=h2" },
      }),
      envFor(db, otherLog),
      user,
    );
    const otherBody = (await other.json()) as { incomeArs: number };
    assert.equal(otherBody.incomeArs, 700000);
    const incomeSql = otherLog.find((sql) => sql.includes("FROM incomes"));
    assert.match(incomeSql ?? "", /household_id = \?/);
  });
});
