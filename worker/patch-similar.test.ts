import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Env } from "./env";
import {
  similarCountSql,
  similarUpdateSql,
  type SimilarFilter,
} from "./similar-sql";
import { handleTransactions } from "./transactions";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const user = { id: "u1", email: "a@b.co", name: "Ana", image: null };
const DESC = "MERCADO";

type Bound = {
  bind(...values: unknown[]): Bound;
  all(): Promise<{ results?: Record<string, unknown>[] }>;
  first(): Promise<Record<string, unknown> | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
  _sql: string;
  _params(): unknown[];
};

type SimilarBody = {
  ok?: boolean;
  error?: string;
  similarUpdated: number;
  similarCount: number;
  similarCapped?: boolean;
  reintegroCount: number;
  cubiertoCount: number;
  appliedToSimilar: boolean;
};

type TxSnap = {
  category_id: string | null;
  updated_at: number;
  is_payment: number;
};

function openDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of [
    "0001_app.sql",
    "0002_auth.sql",
    "0003_serpix_sync.sql",
    "0004_card_closed.sql",
    "0008_tx_household_desc_idx.sql",
  ]) {
    db.exec(readFileSync(join(root, "migrations", file), "utf8"));
  }
  db.prepare("INSERT INTO users (id, email, name) VALUES ('u1', 'a@b.co', 'Ana')").run();
  db.prepare("INSERT INTO users (id, email, name) VALUES ('u2', 'b@b.co', 'Bea')").run();
  db.prepare(
    "INSERT INTO households (id, name, invite_code) VALUES ('h1', 'Personal', 'CODE1234')",
  ).run();
  db.prepare(
    "INSERT INTO households (id, name, invite_code) VALUES ('h2', 'Hogar', 'HOGAR123')",
  ).run();
  db.prepare(
    `INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES
      ('h1', 'u1', 'owner', 1),
      ('h1', 'u2', 'member', 2),
      ('h2', 'u1', 'owner', 3),
      ('h2', 'u2', 'member', 4)`,
  ).run();
  db.prepare(
    `INSERT INTO categories (id, slug, name, kind) VALUES
      ('c-old', 'old', 'Vieja', 'expense'),
      ('c-new', 'new', 'Nueva', 'expense'),
      ('uncategorized', 'uncategorized', 'Sin categoría', 'expense')`,
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

function patch(body: unknown, householdId?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (householdId) headers.set("cookie", `lc_household=${householdId}`);
  return new Request("https://tarask.test/api/transactions", {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
}

async function readPatch(res: Response): Promise<SimilarBody> {
  const body = (await res.json()) as SimilarBody;
  assert.equal(res.status, 200, JSON.stringify(body));
  return body;
}

function otherHousehold(db: DatabaseSync) {
  db.prepare(
    "INSERT INTO households (id, name, invite_code) VALUES ('h-other', 'Otro', 'OTHER123')",
  ).run();
}

function insertTx(
  db: DatabaseSync,
  row: {
    id: string;
    householdId?: string;
    date?: string;
    description?: string;
    categoryId?: string | null;
    ownership?: string;
    paidBy?: string | null;
    business?: number;
    payment?: number;
  },
) {
  const householdId = row.householdId ?? "h1";
  const description = row.description ?? DESC;
  db.prepare(
    `INSERT INTO transactions (
       id, household_id, date, description_raw, description_normalized,
       amount_ars, category_id, ownership, paid_by_user_id, external_fingerprint,
       is_business, is_payment, source, updated_at
     ) VALUES (?, ?, ?, ?, ?, '10.00', ?, ?, ?, ?, ?, ?, 'manual', 10)`,
  ).run(
    row.id,
    householdId,
    row.date ?? "2026-04-01",
    description,
    description,
    row.categoryId === undefined ? "c-old" : row.categoryId,
    row.ownership ?? "personal",
    row.paidBy === undefined ? "u1" : row.paidBy,
    `fp-${householdId}-${row.id}`,
    row.business ?? 0,
    row.payment ?? 0,
  );
}

function tx(db: DatabaseSync, id: string): TxSnap {
  return db
    .prepare(
      "SELECT category_id, updated_at, is_payment FROM transactions WHERE id = ?",
    )
    .get(id) as TxSnap;
}

function ids(db: DatabaseSync, sql: string): string[] {
  return (db.prepare(sql).all() as Array<{ id: string }>).map((row) => row.id);
}

describe("applyToSimilar", () => {
  it("updates only visible non-business rows that are not already in the category", async () => {
    const db = openDb();
    otherHousehold(db);
    insertTx(db, { id: "t-target" });
    insertTx(db, { id: "t-own" });
    insertTx(db, { id: "t-shared", ownership: "shared", paidBy: "u2" });
    insertTx(db, { id: "t-uncat", categoryId: "uncategorized" });
    insertTx(db, { id: "t-null", categoryId: null });
    insertTx(db, { id: "t-biz", business: 1 });
    insertTx(db, { id: "t-u2", paidBy: "u2" });
    insertTx(db, { id: "t-new", categoryId: "c-new" });
    insertTx(db, { id: "t-diff", description: "OTRO" });
    insertTx(db, { id: "t-other", householdId: "h-other" });

    const body = await readPatch(
      await handleTransactions(
        patch({ id: "t-target", categoryId: "c-new", applyToSimilar: true }),
        envFor(db),
        user,
      ),
    );
    assert.equal(body.similarUpdated, 4);
    assert.equal(body.similarCount, 5);
    assert.equal(body.similarCapped, undefined);
    assert.equal(body.appliedToSimilar, true);

    for (const id of ["t-target", "t-own", "t-shared", "t-uncat", "t-null"]) {
      assert.equal(tx(db, id).category_id, "c-new", id);
    }
    for (const id of ["t-biz", "t-u2", "t-diff", "t-other"]) {
      assert.equal(tx(db, id).category_id, "c-old", id);
      assert.equal(tx(db, id).updated_at, 10, id);
    }
    assert.equal(tx(db, "t-new").category_id, "c-new");
    assert.equal(tx(db, "t-new").updated_at, 10);
  });

  it("leaves similar rows untouched when applyToSimilar is false", async () => {
    const db = openDb();
    insertTx(db, { id: "t-target" });
    insertTx(db, { id: "t-own" });
    insertTx(db, { id: "t-shared", ownership: "shared", paidBy: "u2" });

    const body = await readPatch(
      await handleTransactions(
        patch({ id: "t-target", categoryId: "c-new" }),
        envFor(db),
        user,
      ),
    );
    assert.equal(body.similarUpdated, 0);
    assert.equal(body.similarCount, 3);
    assert.equal(body.similarCapped, undefined);
    assert.equal(body.appliedToSimilar, false);
    assert.equal(tx(db, "t-target").category_id, "c-new");
    assert.equal(tx(db, "t-own").category_id, "c-old");
    assert.equal(tx(db, "t-own").updated_at, 10);
    assert.equal(tx(db, "t-shared").category_id, "c-old");
    assert.equal(tx(db, "t-shared").updated_at, 10);
  });

  it("ignores personal rows in a shared-only household", async () => {
    const db = openDb();
    insertTx(db, { id: "t-target", householdId: "h2", ownership: "shared", paidBy: "u1" });
    insertTx(db, { id: "t-own", householdId: "h2" });
    insertTx(db, { id: "t-u2", householdId: "h2", paidBy: "u2" });
    insertTx(db, { id: "t-shared", householdId: "h2", ownership: "shared", paidBy: "u2" });
    insertTx(db, { id: "t-biz", householdId: "h2", business: 1 });
    insertTx(db, {
      id: "t-new",
      householdId: "h2",
      ownership: "shared",
      paidBy: "u2",
      categoryId: "c-new",
    });

    const body = await readPatch(
      await handleTransactions(
        patch({ id: "t-target", categoryId: "c-new", applyToSimilar: true }, "h2"),
        envFor(db),
        user,
      ),
    );
    assert.equal(body.similarUpdated, 1);
    assert.equal(body.similarCount, 2);
    assert.equal(tx(db, "t-target").category_id, "c-new");
    assert.equal(tx(db, "t-shared").category_id, "c-new");
    for (const id of ["t-own", "t-u2", "t-biz"]) {
      assert.equal(tx(db, id).category_id, "c-old", id);
      assert.equal(tx(db, id).updated_at, 10, id);
    }
    assert.equal(tx(db, "t-new").updated_at, 10);
  });

  it("caps similar updates at the 500 most recent rows", async () => {
    const db = openDb();
    const insert = db.prepare(
      `INSERT INTO transactions (
         id, household_id, date, description_raw, description_normalized,
         amount_ars, category_id, ownership, paid_by_user_id, external_fingerprint,
         is_business, is_payment, source, updated_at
       ) VALUES (?, 'h1', ?, ?, ?, '10.00', 'c-old', 'personal', 'u1', ?, 0, 0, 'manual', 10)`,
    );
    for (let i = 0; i < 520; i++) {
      const id = "s" + String(i).padStart(4, "0");
      insert.run(id, i < 120 ? "2026-01-01" : "2026-06-01", DESC, DESC, `fp-${id}`);
    }
    insertTx(db, { id: "t-target", date: "2026-07-01" });

    const body = await readPatch(
      await handleTransactions(
        patch({ id: "t-target", categoryId: "c-new", applyToSimilar: true }),
        envFor(db),
        user,
      ),
    );
    assert.equal(body.similarUpdated, 500);
    assert.equal(body.similarCount, 501);
    assert.equal(body.similarCapped, true);

    const expected = [
      ...Array.from({ length: 400 }, (_, i) => "s" + String(i + 120).padStart(4, "0")),
      ...Array.from({ length: 100 }, (_, i) => "s" + String(i).padStart(4, "0")),
    ];
    assert.deepEqual(
      ids(
        db,
        `SELECT id FROM transactions
         WHERE category_id = 'c-new' AND id != 't-target'
         ORDER BY date DESC, id`,
      ),
      expected,
    );
    assert.deepEqual(
      ids(db, "SELECT id FROM transactions WHERE category_id = 'c-old' ORDER BY id"),
      Array.from({ length: 20 }, (_, i) => "s" + String(i + 100).padStart(4, "0")),
    );
    assert.equal(tx(db, "s0100").updated_at, 10);
    assert.equal(tx(db, "s0119").updated_at, 10);
    assert.notEqual(tx(db, "s0099").updated_at, 10);
    assert.notEqual(tx(db, "s0120").updated_at, 10);
  });

  it("keeps business and other members' personal rows out of reintegro and cubierto", async () => {
    for (const flag of ["householdReimbursement", "householdBillCovered"] as const) {
      for (const householdId of ["h1", "h2"]) {
        const db = openDb();
        otherHousehold(db);
        const sharedOnly = householdId === "h2";
        insertTx(db, { id: "t-target", householdId });
        insertTx(db, { id: "t-own", householdId });
        insertTx(db, { id: "t-u2", householdId, paidBy: "u2" });
        insertTx(db, { id: "t-shared", householdId, ownership: "shared", paidBy: "u2" });
        insertTx(db, { id: "t-biz", householdId, business: 1 });
        insertTx(db, {
          id: "t-paid",
          householdId,
          ownership: "shared",
          paidBy: "u2",
          payment: 1,
        });
        insertTx(db, { id: "t-diff", householdId, description: "OTRO" });
        insertTx(db, { id: "t-other", householdId: "h-other" });

        const label = `${flag} ${householdId}`;
        const body = await readPatch(
          await handleTransactions(
            patch(
              { id: "t-target", [flag]: true, applyToSimilar: true },
              sharedOnly ? "h2" : undefined,
            ),
            envFor(db),
            user,
          ),
        );
        const would = sharedOnly ? 1 : 2;
        assert.equal(body.similarUpdated, would, label);
        assert.equal(body.similarCount, 1 + would, label);
        assert.equal(body.similarCapped, undefined, label);
        if (flag === "householdReimbursement") {
          assert.equal(body.reintegroCount, 1 + would, label);
          assert.equal(body.cubiertoCount, 0, label);
        } else {
          assert.equal(body.cubiertoCount, 1 + would, label);
          assert.equal(body.reintegroCount, 0, label);
        }
        assert.equal(tx(db, "t-target").is_payment, 1, label);
        assert.equal(tx(db, "t-shared").is_payment, 1, label);
        assert.equal(tx(db, "t-own").is_payment, sharedOnly ? 0 : 1, label);
        for (const id of ["t-u2", "t-biz", "t-diff", "t-other"]) {
          assert.equal(tx(db, id).is_payment, 0, `${label} ${id}`);
          assert.equal(tx(db, id).updated_at, 10, `${label} ${id}`);
        }
        assert.equal(tx(db, "t-paid").is_payment, 1, label);
        assert.equal(tx(db, "t-paid").updated_at, 10, label);
        if (sharedOnly) assert.equal(tx(db, "t-own").updated_at, 10, label);
      }
    }
  });

  it("still enqueues the business target and does not sync similar rows", async () => {
    const db = openDb();
    insertTx(db, { id: "t-target", business: 1 });
    insertTx(db, { id: "t-own" });
    insertTx(db, { id: "t-biz", business: 1 });

    const body = await readPatch(
      await handleTransactions(
        patch({ id: "t-target", categoryId: "c-new", applyToSimilar: true }),
        envFor(db),
        user,
      ),
    );
    assert.equal(body.similarUpdated, 1);
    assert.equal(body.similarCount, 2);
    assert.equal(tx(db, "t-target").category_id, "c-new");
    assert.equal(tx(db, "t-own").category_id, "c-new");
    assert.equal(tx(db, "t-biz").category_id, "c-old");
    assert.equal(tx(db, "t-biz").updated_at, 10);
    const outbox = db
      .prepare("SELECT tx_id, type FROM serpix_outbox ORDER BY tx_id")
      .all() as Array<{ tx_id: string; type: string }>;
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0]?.tx_id, "t-target");
    assert.equal(outbox[0]?.type, "upsert");
  });

  it("looks up similar ids by primary key and the description index", () => {
    const db = openDb();
    const filters: SimilarFilter[] = [
      { sharedOnly: false, extra: "category_id IS NOT ?" },
      { sharedOnly: true, extra: "category_id IS NOT ?" },
      { sharedOnly: false, extra: "is_payment = 0" },
      { sharedOnly: true, extra: "is_payment = 0" },
    ];
    for (const filter of filters) {
      const set = filter.extra.startsWith("category")
        ? "category_id = ?, updated_at = ?"
        : "is_payment = 1, updated_at = ?";
      const sql = similarUpdateSql(set, filter);
      assert.equal(sql.includes("INDEXED BY"), false, sql);
      const head = sql.slice(0, sql.toUpperCase().indexOf("SELECT"));
      assert.equal(/household_id/.test(head), false, sql);
      const binds = filter.extra.startsWith("category")
        ? filter.sharedOnly
          ? ["c-new", 1, "h1", DESC, "t-target", "c-new"]
          : ["c-new", 1, "h1", DESC, "t-target", "u1", "c-new"]
        : filter.sharedOnly
          ? [1, "h1", DESC, "t-target"]
          : [1, "h1", DESC, "t-target", "u1"];
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...binds) as Array<{
        parent: number;
        detail: string;
      }>;
      assertSimilarPlan(plan, sql);

      const countSql = similarCountSql(filter);
      const countBinds = filter.extra.startsWith("category")
        ? filter.sharedOnly
          ? ["h1", DESC, "t-target", "c-new"]
          : ["h1", DESC, "t-target", "u1", "c-new"]
        : filter.sharedOnly
          ? ["h1", DESC, "t-target"]
          : ["h1", DESC, "t-target", "u1"];
      const countPlan = db.prepare(`EXPLAIN QUERY PLAN ${countSql}`).all(...countBinds) as Array<{
        detail: string;
      }>;
      const countDetail = countPlan.map((line) => line.detail).join("\n");
      assert.match(countDetail, /tx_household_desc_idx \(household_id=\? AND description_normalized=\?\)/);
      assert.equal(hasBareScan(countPlan), false, countDetail);
    }
  });
});

function hasBareScan(plan: Array<{ detail: string }>): boolean {
  return plan.some(
    (line) => /\bSCAN\s+transactions\b/.test(line.detail) && !/\bUSING\s+INDEX\b/.test(line.detail),
  );
}

function assertSimilarPlan(plan: Array<{ parent: number; detail: string }>, sql: string) {
  const detail = plan.map((line) => line.detail).join("\n");
  assert.match(detail, /tx_household_desc_idx \(household_id=\? AND description_normalized=\?\)/, sql);
  assert.equal(hasBareScan(plan), false, detail);
  const outer = plan.filter((line) => line.parent === 0).map((line) => line.detail).join("\n");
  assert.match(outer, /sqlite_autoindex_transactions_1/, detail);
  assert.doesNotMatch(outer, /tx_household_/, detail);
}
