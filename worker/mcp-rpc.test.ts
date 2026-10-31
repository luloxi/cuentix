import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ADMIN_EMAIL } from "./auth";
import type { Env } from "./env";
import { primeFxForTests } from "./fx";
import { shiftPeriod, todayAr } from "./http";
import worker from "./index";
import { deudaAhorroPatrimonio, resumenMensual, ultimosMovimientos, type RpcResult } from "./mcp-rpc";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "svc-token-fixture-not-a-secret";
const WALLET = "0x1111111111111111111111111111111111111111";
const RECEIPT_BLOB = "r2://receipt-blob-do-not-leak";
const CODES = ["no_owner", "invalid", "not_found", "not_enabled", "internal"] as const;

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

function envFor(db: DatabaseSync, opts?: { token?: string | null; email?: string }): Env {
  const env: Env = {
    DB: wrap(db) as Env["DB"],
    RECEIPTS: { put: async () => null, get: async () => null },
    AI: { toMarkdown: async () => null },
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
  };
  if (opts?.token !== null) env.MCP_SERVICE_TOKEN = opts?.token ?? TOKEN;
  if (opts?.email) env.MCP_SERVICE_USER_EMAIL = opts.email;
  return env;
}

async function seed(db: DatabaseSync) {
  const now = Date.now();
  db.prepare("INSERT INTO users (id, email, name) VALUES ('user-luciano', ?, 'Luciano')").run(ADMIN_EMAIL);
  db.prepare("INSERT INTO users (id, email, name) VALUES ('user-b', 'b@example.com', 'Other')").run();
  db.prepare(
    "INSERT INTO auth_user (id, name, email, email_verified, created_at, updated_at) VALUES ('user-luciano', 'Luciano', ?, 1, ?, ?)",
  ).run(ADMIN_EMAIL, now, now);
  db.prepare(
    "INSERT INTO auth_user (id, name, email, email_verified, created_at, updated_at) VALUES ('user-b', 'Other', 'b@example.com', 1, ?, ?)",
  ).run(now, now);
  db.prepare("INSERT INTO households (id, name, invite_code) VALUES ('h-personal', 'Personal', 'PERS0001')").run();
  db.prepare("INSERT INTO households (id, name, invite_code) VALUES ('h-casa', 'Casa', 'CASA0001')").run();
  db.prepare(
    "INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES ('h-casa', 'user-luciano', 'owner', 1)",
  ).run();
  db.prepare(
    "INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES ('h-personal', 'user-luciano', 'owner', 5)",
  ).run();
  db.prepare(
    "INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES ('h-personal', 'user-b', 'member', 6)",
  ).run();

  const categories: Array<[string, string, string]> = [
    ["cat-comida", "comida", "Comida"],
    ["cat-cafe", "cafe", "Cafe"],
    ["cat-transporte", "transporte", "Transporte"],
    ["cat-salud", "salud", "Salud"],
    ["cat-ropa", "ropa", "Ropa"],
    ["cat-ocio", "ocio", "Ocio"],
    ["cat-extras", "extras", "Extras"],
    ["cat-alquiler", "alquiler", "Alquiler"],
  ];
  const insertCat = db.prepare(
    "INSERT INTO categories (id, slug, name, kind, is_system) VALUES (?, ?, ?, 'expense', 1)",
  );
  for (const [id, slug, name] of categories) insertCat.run(id, slug, name);

  const insertTx = db.prepare(
    `INSERT INTO transactions (
       id, household_id, date, description_raw, description_normalized,
       amount_ars, amount_usd, is_payment, is_credit, category_id,
       ownership, paid_by_user_id, external_fingerprint, source, bank
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`,
  );
  const tx = (
    id: string,
    date: string,
    description: string,
    ars: string | null,
    usd: string | null,
    category: string | null,
    ownership: string,
    paidBy: string,
    opts?: { payment?: number; credit?: number; household?: string; bank?: string },
  ) => {
    insertTx.run(
      id,
      opts?.household ?? "h-personal",
      date,
      description,
      description,
      ars,
      usd,
      opts?.payment ?? 0,
      opts?.credit ?? 0,
      category,
      ownership,
      paidBy,
      `fp-${id}`,
      opts?.bank ?? "Galicia",
    );
  };

  tx("tx-super", "2026-08-05", "SUPER MERCADO", "10000", null, "cat-comida", "personal", "user-luciano");
  tx("tx-cafe", "2026-08-06", "CAFE USD", null, "20", "cat-cafe", "personal", "user-luciano");
  tx("tx-trans", "2026-08-07", "TRANSPORTE", "4000", null, "cat-transporte", "personal", "user-luciano");
  tx("tx-salud", "2026-08-08", "SALUD", "3000", null, "cat-salud", "personal", "user-luciano");
  tx("tx-ropa", "2026-08-09", "ROPA", "2000", null, "cat-ropa", "personal", "user-luciano");
  tx("tx-ocio", "2026-08-10", "OCIO", "1000", null, "cat-ocio", "personal", "user-luciano");
  tx("tx-extras", "2026-08-11", "EXTRAS", "500", null, "cat-extras", "personal", "user-luciano");
  tx("tx-tuya", "2026-08-12", "CUENTA TUYA", "99999", null, "cat-comida", "personal", "user-luciano");
  tx("tx-transf", "2026-08-13", "TRANSFERENCIA ARS", "77777", null, null, "personal", "user-luciano");
  tx("tx-credit", "2026-08-14", "CREDITO PROMO", "12345", null, "cat-extras", "personal", "user-luciano", {
    credit: 1,
  });
  tx("tx-ajeno", "2026-08-15", "GASTO AJENO", "44444", null, "cat-comida", "personal", "user-b");
  tx("tx-casa", "2026-08-16", "CASA SHARED", "888888", null, "cat-comida", "shared", "user-luciano", {
    household: "h-casa",
  });
  tx("tx-alq", "2026-09-02", "ALQUILER", "3000", null, "cat-alquiler", "shared", "user-luciano", {
    bank: "BBVA",
  });
  tx("tx-pago", "2026-09-03", "PAGO ALQUILER", "1500", null, "cat-alquiler", "shared", "user-luciano", {
    payment: 1,
    bank: "BBVA",
  });

  db.prepare(
    `INSERT INTO receipts (id, household_id, image_url, transaction_id, created_by)
     VALUES ('rcpt-leak', 'h-personal', ?, 'tx-super', 'user-luciano')`,
  ).run(RECEIPT_BLOB);

  const insertIncome = db.prepare(
    `INSERT INTO incomes (id, user_id, household_id, date, label, kind, amount_ars, amount_usd)
     VALUES (?, 'user-luciano', ?, ?, ?, 'variable', ?, ?)`,
  );
  insertIncome.run("inc-aug", "h-personal", "2026-08-10", "Sueldo", "200000", "100");
  insertIncome.run("inc-tuya", "h-personal", "2026-08-11", "CUENTA TUYA", "80000", null);
  insertIncome.run("inc-sep", "h-personal", "2026-09-01", "Sueldo", "50000", null);
  insertIncome.run("inc-casa", "h-casa", "2026-08-10", "Sueldo casa", "999999", null);

  db.prepare(
    `INSERT INTO savings_assets (id, user_id, household_id, kind, label, amount_ars, amount_usd)
     VALUES ('sav-bank', 'user-luciano', 'h-personal', 'bank', 'Caja', '500000', '100')`,
  ).run();
  db.prepare(
    `INSERT INTO savings_assets (
       id, user_id, household_id, kind, label, address, last_balance_usd
     ) VALUES ('sav-evm', 'user-luciano', 'h-personal', 'evm', 'Wallet', ?, '25')`,
  ).run(WALLET);
  db.prepare(
    `INSERT INTO savings_assets (id, user_id, household_id, kind, label, amount_ars, amount_usd)
     VALUES ('sav-b', 'user-b', 'h-personal', 'bank', 'B', '7', '0')`,
  ).run();
  db.prepare(
    `INSERT INTO debt_settings (user_id, saldo_deuda_ars, saldo_deuda_usd, card_last4, force_settled)
     VALUES ('user-luciano', '150000', '10', '4242', 0)`,
  ).run();

  const today = todayAr();
  const prevMonth = shiftPeriod(today.slice(0, 7), -1);
  const points: Array<[string, string, string]> = [
    ["snap-old", "2019-06-01", "1000"],
    ["snap-year", `${today.slice(0, 4)}-01-01`, "300000"],
    ["snap-early", `${prevMonth}-02`, "111111"],
    ["snap-late", `${prevMonth}-20`, "400000"],
  ];
  const insertSnap = db.prepare(
    `INSERT INTO patrimonio_snapshots (
       id, user_id, date, assets_ars, assets_usd, debt_ars, debt_usd, net_worth_ars, fx_rate, source
     ) VALUES (?, 'user-luciano', ?, '0', '0', '0', '0', ?, '1500', 'snapshot')`,
  );
  for (const [id, date, net] of points) insertSnap.run(id, date, net);
}

function pinFx() {
  primeFxForTests({
    blue: 1500,
    byDate: new Map([
      ["2026-08-31", 1000],
      ["2026-09-30", 1100],
    ]),
  });
}

async function httpGet(path: string, env: Env) {
  return worker.fetch(
    new Request(`https://cuentix.test${path}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    }),
    env,
  );
}

function assertShape(value: RpcResult<unknown>) {
  assert.equal(typeof value, "object");
  if (value.ok) {
    assert.equal(Object.hasOwn(value, "data"), true);
    assert.equal(Object.hasOwn(value, "error"), false);
    return;
  }
  assert.equal(value.ok, false);
  assert.equal(typeof value.error.code, "string");
  assert.equal(typeof value.error.message, "string");
  assert.ok(CODES.includes(value.error.code));
  assert.equal(value.error.message.includes(TOKEN), false);
  assert.equal(value.error.message.includes("SELECT"), false);
  assert.equal(/at\s+\S+\s+\(/.test(value.error.message), false);
}

function dataOf<T>(result: RpcResult<T>): T {
  assertShape(result);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected ok");
  return result.data;
}

describe("McpRpc", { concurrency: false }, () => {
  it("matches the HTTP payloads and does not need a bearer token", async () => {
    const db = openDb();
    await seed(db);
    pinFx();
    const env = envFor(db);
    const noToken = envFor(db, { token: null });

    const bareHttp = await worker.fetch(
      new Request("https://cuentix.test/api/svc/deuda-ahorro-patrimonio"),
      noToken,
    );
    assert.equal(bareHttp.status, 401);

    const pairs: Array<[string, RpcResult<unknown>]> = [
      [
        "/api/svc/resumen-mensual?from=2026-08&to=2026-09",
        await resumenMensual(noToken, { from: "2026-08", to: "2026-09" }),
      ],
      ["/api/svc/resumen-mensual", await resumenMensual(noToken, {})],
      ["/api/svc/deuda-ahorro-patrimonio", await deudaAhorroPatrimonio(noToken, {})],
      ["/api/svc/ultimos-movimientos", await ultimosMovimientos(noToken, {})],
      ["/api/svc/ultimos-movimientos?limit=1", await ultimosMovimientos(noToken, { limit: 1 })],
      [
        "/api/svc/ultimos-movimientos?period=2026-08",
        await ultimosMovimientos(noToken, { period: "2026-08" }),
      ],
      ["/api/svc/ultimos-movimientos?q=SUPER", await ultimosMovimientos(noToken, { query: "SUPER" })],
      [
        "/api/svc/ultimos-movimientos?limit=50",
        await ultimosMovimientos(env, { limit: 50 }),
      ],
    ];

    for (const [path, rpc] of pairs) {
      pinFx();
      const res = await httpGet(path, env);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(dataOf(rpc), body);
    }

    const dumped = JSON.stringify(pairs.map((pair) => pair[1]));
    assert.equal(dumped.includes(TOKEN), false);
    assert.equal(dumped.includes(WALLET), false);
    assert.equal(dumped.includes(RECEIPT_BLOB), false);
    assert.equal(dumped.includes("user-luciano"), false);
    assert.equal(dumped.includes("tx-super"), false);

    const wideOk = await resumenMensual(noToken, { from: "2024-02", to: "2026-01" });
    assert.equal(wideOk.ok, true);
    if (wideOk.ok) assert.equal(wideOk.data.months.length, 24);
  });

  it("rejects invalid params with RpcResult invalid and does not throw", async () => {
    const db = openDb();
    await seed(db);
    pinFx();
    const env = envFor(db, { token: null });
    const periods: unknown[] = [
      { from: "2026-13", to: "2026-14" },
      { from: "2026-09", to: "2026-08" },
      { from: "2024-01", to: "2026-01" },
      { from: "2026-08" },
      { from: 202608, to: "2026-09" },
      null,
      [],
      "2026-08",
    ];
    for (const input of periods) {
      const result = await resumenMensual(env, input);
      assertShape(result);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "invalid");
        assert.ok(result.error.message === "invalid period" || result.error.message === "invalid input");
      }
    }

    const limits: unknown[] = [0, 51, -1, 1.5, 100, "51", "abc", true, { limit: 20, period: "2026-13" }];
    for (const input of limits) {
      const result = await ultimosMovimientos(env, typeof input === "object" && input && !Array.isArray(input) && "limit" in input ? input : { limit: input });
      assertShape(result);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, "invalid");
    }

    const badPeriod = await ultimosMovimientos(env, { period: "2026-13" });
    assert.equal(badPeriod.ok, false);
    if (!badPeriod.ok) assert.equal(badPeriod.error.message, "invalid period");

    const emptyQuery = await ultimosMovimientos(env, { query: "" });
    const blankQuery = await ultimosMovimientos(env, { query: "   " });
    const longQuery = await ultimosMovimientos(env, { query: "a".repeat(201) });
    const numberQuery = await ultimosMovimientos(env, { query: 12 });
    for (const result of [emptyQuery, blankQuery, longQuery, numberQuery]) {
      assert.equal(result.ok, false);
      if (!result.ok) assert.deepEqual(result.error, { code: "invalid", message: "invalid query" });
    }

    const edge = await ultimosMovimientos(env, { query: "b".repeat(200) });
    assert.equal(edge.ok, true);
  });

  it("returns no_owner when the configured user is missing", async () => {
    const empty = envFor(openDb(), { token: null });
    for (const result of [
      await resumenMensual(empty, {}),
      await deudaAhorroPatrimonio(empty, {}),
      await ultimosMovimientos(empty, {}),
    ]) {
      assert.deepEqual(result, { ok: false, error: { code: "no_owner", message: "no owner" } });
    }

    const db = openDb();
    await seed(db);
    const missing = envFor(db, { token: null, email: "nobody@example.com" });
    const result = await deudaAhorroPatrimonio(missing, {});
    assert.deepEqual(result, { ok: false, error: { code: "no_owner", message: "no owner" } });
    assert.equal(JSON.stringify(result).includes("nobody@example.com"), false);
  });

  it("uses MCP_SERVICE_USER_EMAIL without a token and matches HTTP", async () => {
    const db = openDb();
    const now = Date.now();
    db.prepare("INSERT INTO users (id, email, name) VALUES ('user-other', 'other@example.com', 'Other')").run();
    db.prepare(
      "INSERT INTO auth_user (id, name, email, email_verified, created_at, updated_at) VALUES ('user-other', 'Other', 'other@example.com', 1, ?, ?)",
    ).run(now, now);
    db.prepare("INSERT INTO users (id, email, name) VALUES ('user-luciano', ?, 'Luciano')").run(ADMIN_EMAIL);
    db.prepare(
      "INSERT INTO auth_user (id, name, email, email_verified, created_at, updated_at) VALUES ('user-luciano', 'Luciano', ?, 1, ?, ?)",
    ).run(ADMIN_EMAIL, now, now);
    db.prepare("INSERT INTO households (id, name, invite_code) VALUES ('h1', 'Personal', 'PERS0001')").run();
    db.prepare(
      "INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES ('h1', 'user-other', 'owner', 1)",
    ).run();
    db.prepare(
      "INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES ('h1', 'user-luciano', 'owner', 2)",
    ).run();
    db.prepare(
      `INSERT INTO savings_assets (id, user_id, household_id, kind, label, amount_ars, amount_usd)
       VALUES ('s-other', 'user-other', 'h1', 'bank', 'Otra', '42', '0')`,
    ).run();
    db.prepare(
      `INSERT INTO savings_assets (id, user_id, household_id, kind, label, amount_ars, amount_usd)
       VALUES ('s-admin', 'user-luciano', 'h1', 'bank', 'Admin', '500000', '0')`,
    ).run();
    pinFx();
    const httpEnv = envFor(db, { email: "other@example.com" });
    const rpcEnv = envFor(db, { token: null, email: "other@example.com" });
    const http = await httpGet("/api/svc/deuda-ahorro-patrimonio", httpEnv);
    assert.equal(http.status, 200);
    const rpc = await deudaAhorroPatrimonio(rpcEnv, {});
    assert.deepEqual(dataOf(rpc), await http.json());
    const body = dataOf(rpc) as { savings: { totalArs: number } };
    assert.equal(body.savings.totalArs, 42);
  });

  it("hides unexpected failures behind a generic internal error", async () => {
    const db = openDb();
    await seed(db);
    const env = envFor(db, { token: null });
    const leak = `SQLITE_ERROR SELECT ${TOKEN} FROM auth_user\n    at buildSvc (${TOKEN}:1:1)`;
    env.DB = {
      prepare() {
        throw new Error(leak);
      },
    } as unknown as Env["DB"];
    const calls = [
      resumenMensual(env, { from: "2026-08", to: "2026-09" }),
      deudaAhorroPatrimonio(env, {}),
      ultimosMovimientos(env, { limit: 5, query: "SUPER" }),
    ];
    for (const pending of calls) {
      const result = await pending;
      assert.deepEqual(result, { ok: false, error: { code: "internal", message: "internal error" } });
      const text = JSON.stringify(result);
      assert.equal(text.includes(TOKEN), false);
      assert.equal(text.includes("SQLITE_ERROR"), false);
      assert.equal(text.includes("SELECT"), false);
      assert.equal(text.includes("buildSvc"), false);
      assert.equal(text.includes("stack"), false);
    }
  });

  it("keeps cloudflare:workers out of the pure module", () => {
    const rpc = readFileSync(join(root, "worker/mcp-rpc.ts"), "utf8");
    const entry = readFileSync(join(root, "worker/entry.ts"), "utf8");
    assert.equal(/from\s+["']cloudflare:workers["']/.test(rpc), false);
    assert.equal(/import\s*\(\s*["']cloudflare:workers["']/.test(rpc), false);
    assert.match(entry, /from "cloudflare:workers"/);
    assert.match(entry, /export \{ default \} from "\.\/index"/);
    assert.match(entry, /export class McpRpc extends WorkerEntrypoint/);
  });
});
