import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Env } from "./env";
import { handleTransactions } from "./transactions";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const user = { id: "u1", email: "a@b.co", name: "Ana", image: null };
const OTHER_CUIT = "3".repeat(11);
const SIXTY_K =
  "outgoing transfer (payee unknown) | transferencia inmediata | 100 - banca online | payee not in export";

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

function insertTx(
  db: DatabaseSync,
  row: {
    id: string;
    date: string;
    description: string;
    amountArs: string;
    bank?: string | null;
    isCredit?: number;
  },
) {
  db.prepare(
    `INSERT INTO transactions (
       id, household_id, date, description_raw, description_normalized,
       amount_ars, is_payment, is_credit, ownership, paid_by_user_id,
       external_fingerprint, source, bank
     ) VALUES (?, 'h1', ?, ?, ?, ?, 0, ?, 'personal', 'u1', ?, 'bbva_import', ?)`,
  ).run(
    row.id,
    row.date,
    row.description,
    row.description,
    row.amountArs,
    row.isCredit ?? 0,
    `fp-${row.id}`,
    row.bank ?? "BBVA",
  );
}

describe("GET /api/transactions revisar", () => {
  it("flags a generic transfer, counts it, and leaves spends, named transfers, and internal twins unflagged", async () => {
    const db = openDb();
    insertTx(db, {
      id: "k60",
      date: "2026-08-18",
      description: SIXTY_K,
      amountArs: "60000",
      bank: "BBVA",
    });
    insertTx(db, {
      id: "cafe",
      date: "2026-08-03",
      description: "Cafe",
      amountArs: "40",
      bank: "BBVA",
    });
    insertTx(db, {
      id: "named",
      date: "2026-08-16",
      description: "PERSONA DEMO | TRANSFERENCIA INMEDIATA",
      amountArs: "70",
      bank: "BBVA",
    });
    insertTx(db, {
      id: "cuit",
      date: "2026-08-16",
      description: `TRANSFERENCIA ${OTHER_CUIT}`,
      amountArs: "71",
      bank: "BBVA",
    });
    insertTx(db, {
      id: "out",
      date: "2026-08-10",
      description: "TRANSFERENCIA",
      amountArs: "100",
      bank: "BBVA",
    });
    insertTx(db, {
      id: "inn",
      date: "2026-08-10",
      description: "TRANSFERENCIA",
      amountArs: "-100",
      bank: "GALICIA",
      isCredit: 1,
    });
    const res = await handleTransactions(
      new Request("https://cuentix.test/api/transactions?limit=50"),
      envFor(db),
      user,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      transactions: Array<{ id: string; revisar?: boolean; descriptionNormalized: string }>;
    };
    const byId = new Map(body.transactions.map((row) => [row.id, row]));
    assert.equal(byId.get("k60")?.revisar, true);
    assert.equal(byId.get("cafe")?.revisar, false);
    assert.equal(byId.get("named")?.revisar, false);
    assert.equal(byId.get("cuit")?.revisar, false);
    assert.equal(byId.get("out")?.revisar, false);
    assert.equal(byId.has("out"), true);
    assert.equal(byId.has("k60"), true);
  });

  it("returns revisar on POST for a generic transfer and not for a normal expense", async () => {
    const db = openDb();
    const env = envFor(db);
    const transfer = await handleTransactions(
      new Request("https://cuentix.test/api/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: "2026-08-10", description: "TRANSFERENCIA", amountArs: 120 }),
      }),
      env,
      user,
    );
    const spend = await handleTransactions(
      new Request("https://cuentix.test/api/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: "2026-08-11", description: "Cafe", amountArs: 50 }),
      }),
      env,
      user,
    );
    assert.equal(transfer.status, 201);
    assert.equal(spend.status, 201);
    const transferBody = (await transfer.json()) as { transaction: { revisar?: boolean } };
    const spendBody = (await spend.json()) as { transaction: { revisar?: boolean } };
    assert.equal(transferBody.transaction.revisar, true);
    assert.equal(spendBody.transaction.revisar, false);
  });
});
