import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { SessionUser } from "./auth";
import { handleBillingSubscription } from "./billing";
import { handleCargas } from "./cargas";
import { handleCompartidoStats } from "./compartido";
import type { Env } from "./env";
import { primeFxForTests } from "./fx";
import { handleIncomes } from "./incomes-api";
import worker from "./index";

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

function wrap(db: DatabaseSync) {
  return {
    prepare(sql: string) {
      let params: unknown[] = [];
      const stmt = {
        bind(...values: unknown[]) {
          params = values;
          return stmt;
        },
        async all() {
          return { results: db.prepare(sql).all(...(params as never[])) as Record<string, unknown>[] };
        },
        async first() {
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

function envFor(db: DatabaseSync, extra?: Partial<Env>): Env {
  return {
    DB: wrap(db) as Env["DB"],
    RECEIPTS: { put: async () => null, get: async () => null },
    AI: { toMarkdown: async () => null },
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    ...extra,
  };
}

function seed(db: DatabaseSync) {
  const now = Date.now();
  db.prepare("INSERT INTO users (id, email, name) VALUES ('user-a', 'a@example.com', 'Member A')").run();
  db.prepare("INSERT INTO users (id, email, name) VALUES ('user-b', 'b@example.com', 'Member B')").run();
  db.prepare("INSERT INTO households (id, name, invite_code) VALUES ('h1', 'Personal', 'CODE0001')").run();
  db.prepare("INSERT INTO households (id, name, invite_code) VALUES ('h2', 'Otra', 'CODE0002')").run();
  db.prepare(
    "INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES ('h1', 'user-a', 'owner', 1)",
  ).run();
  db.prepare(
    "INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES ('h1', 'user-b', 'member', 2)",
  ).run();
  db.prepare(
    "INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES ('h2', 'user-a', 'owner', 3)",
  ).run();
  db.prepare(
    "INSERT INTO categories (id, slug, name, kind, is_system) VALUES ('cat-comida', 'comida', 'Comida', 'expense', 1)",
  ).run();
  db.prepare(
    `INSERT INTO incomes (id, user_id, household_id, date, label, kind, amount_ars, created_at, updated_at)
     VALUES ('inc-h1', 'user-a', 'h1', '2026-08-10', 'Sueldo', 'variable', '500000', ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO incomes (id, user_id, household_id, date, label, kind, amount_ars, created_at, updated_at)
     VALUES ('inc-h1-jul', 'user-a', 'h1', '2026-07-10', 'Extra julio', 'variable', '80000', ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO incomes (id, user_id, household_id, date, label, kind, amount_ars, created_at, updated_at)
     VALUES ('inc-h2', 'user-a', 'h2', '2026-08-10', 'Otro hogar', 'variable', '700000', ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO incomes (id, user_id, household_id, date, label, kind, frequency, amount_ars, created_at, updated_at)
     VALUES ('inc-rec', 'user-a', 'h1', '2026-06-05', 'Sueldo mensual', 'recurring', 'mensual', '100000', ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO card_statements (id, household_id, source, file_name, imported_at, row_count)
     VALUES ('st1', 'h1', 'bbva_xlsx', 'ultimos-movimientos.xlsx', ?, 4)`,
  ).run(now);
  db.prepare(
    `INSERT INTO receipts (id, household_id, image_url, merchant_name, receipt_date, status, created_at)
     VALUES ('rc1', 'h1', 'r2://ticket-demo', 'SUPER DEMO', '2026-08-02', 'parsed', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO receipt_items (id, receipt_id, name, quantity, line_total)
     VALUES ('ri1', 'rc1', 'Cafe demo', '1', '1200')`,
  ).run();
  const tx = db.prepare(
    `INSERT INTO transactions (
       id, household_id, date, description_raw, description_normalized,
       amount_ars, is_payment, is_credit, ownership, paid_by_user_id,
       category_id, external_fingerprint, source, statement_id, bank
     ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)`,
  );
  tx.run(
    "tx-stmt",
    "h1",
    "2026-08-01",
    "SUPER DEMO",
    "SUPER DEMO",
    "1400.00",
    "personal",
    "user-a",
    "cat-comida",
    "fp-stmt",
    "bbva_xlsx",
    "st1",
    "BBVA",
  );
  tx.run(
    "tx-manual",
    "h1",
    "2026-08-03",
    "Kiosco demo",
    "Kiosco demo",
    "900.00",
    "personal",
    "user-a",
    "cat-comida",
    "fp-manual",
    "manual",
    null,
    null,
  );
  tx.run(
    "tx-shared",
    "h1",
    "2026-08-12",
    "Almacen demo",
    "Almacen demo",
    "3200.00",
    "shared",
    "user-a",
    "cat-comida",
    "fp-shared",
    "manual",
    null,
    null,
  );
  tx.run(
    "tx-shared-jul",
    "h1",
    "2026-07-12",
    "Verduleria demo",
    "Verduleria demo",
    "1100.00",
    "shared",
    "user-b",
    "cat-comida",
    "fp-shared-jul",
    "manual",
    null,
    null,
  );
  db.prepare(
    `INSERT INTO subscriptions (polar_subscription_id, user_id, status, current_period_end, updated_at)
     VALUES ('sub_demo', 'user-a', 'active', ?, ?)`,
  ).run(now + 86400000, now);
}

describe("section apis", { concurrency: false }, () => {
  it("GET /api/incomes is period-aware and household-scoped", async () => {
    const db = openDb();
    seed(db);
    primeFxForTests({ blue: 1000 });
    const august = await handleIncomes(
      new Request("https://cuentix.test/api/incomes?period=2026-08", {
        headers: { cookie: "lc_household=h1" },
      }),
      envFor(db),
      user,
    );
    assert.equal(august.status, 200);
    const body = (await august.json()) as {
      period: string;
      incomes: Array<{ id: string; label: string; kind: string }>;
      periodEntries: Array<{ sourceId: string; expected: boolean }>;
      monthlyEvolution: Array<{ period: string; amountArs: number }>;
    };
    assert.equal(body.period, "2026-08");
    const ids = body.incomes.map((row) => row.id).sort();
    assert.deepEqual(ids, ["inc-h1", "inc-rec"]);
    assert.equal(body.incomes.some((row) => row.id === "inc-h2"), false);
    assert.equal(body.incomes.some((row) => row.id === "inc-h1-jul"), false);
    assert.ok(body.periodEntries.some((row) => row.sourceId === "inc-h1" && !row.expected));
    assert.ok(body.periodEntries.some((row) => row.sourceId === "inc-rec" && row.expected));
    const augustChart = body.monthlyEvolution.find((row) => row.period === "2026-08");
    assert.ok((augustChart?.amountArs ?? 0) >= 600000);

    const other = await handleIncomes(
      new Request("https://cuentix.test/api/incomes?period=2026-08", {
        headers: { cookie: "lc_household=h2" },
      }),
      envFor(db),
      user,
    );
    const otherBody = (await other.json()) as { incomes: Array<{ id: string }> };
    assert.deepEqual(otherBody.incomes.map((row) => row.id), ["inc-h2"]);

    const july = await handleIncomes(
      new Request("https://cuentix.test/api/incomes?period=2026-07", {
        headers: { cookie: "lc_household=h1" },
      }),
      envFor(db),
      user,
    );
    const julyBody = (await july.json()) as { incomes: Array<{ id: string }> };
    const julyIds = julyBody.incomes.map((row) => row.id).sort();
    assert.deepEqual(julyIds, ["inc-h1-jul", "inc-rec"]);
  });

  it("POST /api/incomes writes into the active household and DELETE removes it", async () => {
    const db = openDb();
    seed(db);
    const created = await handleIncomes(
      new Request("https://cuentix.test/api/incomes", {
        method: "POST",
        headers: { cookie: "lc_household=h1", "content-type": "application/json" },
        body: JSON.stringify({
          date: "2026-08-20",
          label: "Freelance demo",
          amountArs: 15000,
          kind: "variable",
        }),
      }),
      envFor(db),
      user,
    );
    assert.equal(created.status, 200);
    const createdBody = (await created.json()) as { income: { id: string; label: string } };
    assert.equal(createdBody.income.label, "Freelance demo");
    const row = db.prepare("SELECT household_id AS hid FROM incomes WHERE id = ?").get(createdBody.income.id) as {
      hid: string;
    };
    assert.equal(row.hid, "h1");

    const removed = await handleIncomes(
      new Request(`https://cuentix.test/api/incomes?id=${createdBody.income.id}`, {
        method: "DELETE",
        headers: { cookie: "lc_household=h1" },
      }),
      envFor(db),
      user,
    );
    assert.equal(removed.status, 200);
    const gone = db.prepare("SELECT id FROM incomes WHERE id = ?").get(createdBody.income.id);
    assert.equal(gone, undefined);
  });

  it("GET /api/cargas lists statements, receipts and manuals", async () => {
    const db = openDb();
    seed(db);
    const res = await handleCargas(
      new Request("https://cuentix.test/api/cargas", { headers: { cookie: "lc_household=h1" } }),
      envFor(db),
      user,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      items: Array<{ kind: string; typeLabel: string; count: number; fileName: string | null }>;
    };
    const kinds = new Set(body.items.map((item) => item.kind));
    assert.equal(kinds.has("manual"), true);
    assert.equal(kinds.has("receipt"), true);
    assert.equal(kinds.has("statement"), true);
    const statement = body.items.find((item) => item.kind === "statement");
    assert.match(statement?.typeLabel ?? "", /BBVA/);
    assert.equal(statement?.count, 4);
    const receipt = body.items.find((item) => item.kind === "receipt");
    assert.equal(receipt?.fileName, "SUPER DEMO");
    assert.equal(receipt?.count, 1);
  });

  it("GET /api/stats/compartido returns household-scoped shared spend", async () => {
    const db = openDb();
    seed(db);
    primeFxForTests({ blue: 1000 });
    const res = await handleCompartidoStats(
      new Request("https://cuentix.test/api/stats/compartido?period=2026-08", {
        headers: { cookie: "lc_household=h1" },
      }),
      envFor(db),
      user,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      householdName: string;
      period: string;
      prevPeriod: string;
      prevTotalArs: number;
      inviteCode: string;
      expenses: Array<{ description: string; amountCombined: number }>;
      categories: Array<{ slug: string; total: number }>;
      summary: { totalArsCombined: number };
    };
    assert.equal(body.householdName, "Personal");
    assert.equal(body.period, "2026-08");
    assert.equal(body.prevPeriod, "2026-07");
    assert.equal(body.inviteCode, "CODE0001");
    assert.equal(body.summary.totalArsCombined, 3200);
    assert.equal(body.prevTotalArs, 1100);
    assert.equal(body.expenses.length, 1);
    assert.equal(body.expenses[0]?.description, "Almacen demo");
    assert.equal(body.categories[0]?.slug, "comida");
  });

  it("GET /api/billing/subscription returns the plan and stored row", async () => {
    const db = openDb();
    seed(db);
    const res = await handleBillingSubscription(
      new Request("https://cuentix.test/api/billing/subscription"),
      envFor(db),
      user,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      configured: boolean;
      plan: { name: string; amountArs: number };
      subscription: { status: string; polarSubscriptionId: string };
    };
    assert.equal(body.configured, false);
    assert.equal(body.plan.name, "Pro");
    assert.equal(body.plan.amountArs, 9990);
    assert.equal(body.subscription.status, "active");
    assert.equal(body.subscription.polarSubscriptionId, "sub_demo");
    const text = JSON.stringify(body);
    assert.equal(/sk_|whsec_|POLAR_ACCESS_TOKEN/.test(text), false);
  });

  it("rejects unauthenticated calls to the new routes", async () => {
    const db = openDb();
    const env = envFor(db);
    for (const path of [
      "/api/incomes?period=2026-08",
      "/api/cargas",
      "/api/stats/compartido",
      "/api/billing/subscription",
    ]) {
      const res = await worker.fetch(new Request(`https://cuentix.test${path}`), env);
      assert.equal(res.status, 401, path);
    }
  });
});
