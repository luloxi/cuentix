import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { manualFingerprintMaterial } from "../src/lib/manual-expense";
import type { Env } from "./env";
import { sha256Hex } from "./http";
import { handleTransactions } from "./transactions";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const user = { id: "u1", email: "a@b.co", name: "Ana", image: null };

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
  ]) {
    db.exec(readFileSync(join(root, "migrations", file), "utf8"));
  }
  db.prepare("INSERT INTO users (id, email, name) VALUES ('u1', 'a@b.co', 'Ana')").run();
  db.prepare(
    "INSERT INTO households (id, name, invite_code) VALUES ('h1', 'Personal', 'CODE1234')",
  ).run();
  db.prepare(
    "INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES ('h1', 'u1', 'owner', 1)",
  ).run();
  db.prepare(
    "INSERT INTO categories (id, slug, name, kind) VALUES ('c1', 'uncategorized', 'Sin categoría', 'expense')",
  ).run();
  return db;
}

function wrap(db: DatabaseSync) {
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
        const results = statements.map((s) => {
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

function envFor(db: DatabaseSync): Env {
  return {
    DB: wrap(db) as Env["DB"],
    RECEIPTS: { put: async () => null, get: async () => null },
    AI: { toMarkdown: async () => null },
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
  };
}

function post(body: unknown): Request {
  return new Request("https://cuentix.test/api/transactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch(body: unknown): Request {
  return new Request("https://cuentix.test/api/transactions", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("manual expense duplicates", () => {
  it("inserts two identical expenses and flags the second", async () => {
    const db = openDb();
    const env = envFor(db);
    const body = {
      date: "2026-08-01",
      description: "Café",
      amountArs: 500,
      amountUsd: null,
    };
    const first = await handleTransactions(post(body), env, user);
    const second = await handleTransactions(post(body), env, user);
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const a = (await first.json()) as {
      possibleDuplicate?: boolean;
      transaction: { id: string };
    };
    const b = (await second.json()) as {
      possibleDuplicate?: boolean;
      duplicateOf?: string;
      transaction: { id: string };
    };
    assert.equal(a.possibleDuplicate, undefined);
    assert.equal(b.possibleDuplicate, true);
    assert.equal(b.duplicateOf, a.transaction.id);

    const material = manualFingerprintMaterial({
      householdId: "h1",
      date: "2026-08-01",
      description: "Café",
      amountArs: "500.00",
      amountUsd: null,
    });
    const base = (await sha256Hex(material)).slice(0, 32);
    const rows = db
      .prepare(
        "SELECT id, external_fingerprint FROM transactions ORDER BY created_at, id",
      )
      .all() as Array<{ id: string; external_fingerprint: string }>;
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.external_fingerprint, base);
    assert.equal(rows[1]?.external_fingerprint, `${base}#2`);
  });

  it("PATCH onto an existing fingerprint does not 409", async () => {
    const db = openDb();
    const env = envFor(db);
    const coffee = await handleTransactions(
      post({ date: "2026-08-01", description: "Café", amountArs: 500 }),
      env,
      user,
    );
    const tea = await handleTransactions(
      post({ date: "2026-08-02", description: "Té", amountArs: 500 }),
      env,
      user,
    );
    assert.equal(coffee.status, 201);
    assert.equal(tea.status, 201);
    const coffeeBody = (await coffee.json()) as { transaction: { id: string } };
    const teaBody = (await tea.json()) as { transaction: { id: string } };
    const res = await handleTransactions(
      patch({
        id: teaBody.transaction.id,
        date: "2026-08-01",
        description: "Café",
        amountArs: 500,
      }),
      env,
      user,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { possibleDuplicate?: boolean; duplicateOf?: string };
    assert.equal(body.possibleDuplicate, true);
    assert.equal(body.duplicateOf, coffeeBody.transaction.id);
    const count = db.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number };
    assert.equal(count.n, 2);
    const fps = db
      .prepare("SELECT external_fingerprint FROM transactions ORDER BY external_fingerprint")
      .all() as Array<{ external_fingerprint: string }>;
    assert.equal(new Set(fps.map((row) => row.external_fingerprint)).size, 2);
  });
});
