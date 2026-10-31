import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { historyNote } from "../src/lib/patrimonio";
import { ADMIN_EMAIL, type SessionUser } from "./auth";
import { handleDashboard } from "./dashboard";
import type { Env } from "./env";
import { handleAhorros, handleDebtStats, handlePatrimonio } from "./finance";
import { primeFxForTests } from "./fx";
import { sha256Hex, shiftPeriod, todayAr } from "./http";
import worker from "./index";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "svc-token-fixture-not-a-secret";
const COOKIE = "cookie-session-fixture";
const OTHER_COOKIE = "cookie-session-other";
const WALLET = "0x1111111111111111111111111111111111111111";
const RECEIPT_BLOB = "r2://receipt-blob-do-not-leak";

const luciano: SessionUser = {
  id: "user-luciano",
  email: ADMIN_EMAIL,
  name: "Luciano",
  image: null,
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

function envFor(
  db: DatabaseSync,
  opts?: { token?: string | null; email?: string },
): Env {
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

function bearer(token: string | null): HeadersInit {
  return token ? { authorization: `Bearer ${token}` } : {};
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

  const insertSession = db.prepare(
    `INSERT INTO auth_session (id, expires_at, token, created_at, updated_at, user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  insertSession.run("sess-a", now + 86_400_000, await sha256Hex(COOKIE), now, now, "user-luciano");
  insertSession.run("sess-b", now + 86_400_000, await sha256Hex(OTHER_COOKIE), now, now, "user-b");
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

async function call(path: string, env: Env, extra?: { token?: string | null; cookie?: string; method?: string }) {
  const headers = new Headers(bearer(extra?.token === undefined ? TOKEN : extra.token));
  if (extra?.cookie) headers.set("cookie", extra.cookie);
  return worker.fetch(
    new Request(`https://cuentix.test${path}`, { method: extra?.method ?? "GET", headers }),
    env,
  );
}

describe("service api", { concurrency: false }, () => {
  it("rejects a missing token, a wrong token, and an unset secret with the same 401", async () => {
    const db = openDb();
    const missing = await call("/api/svc/resumen-mensual", envFor(db), { token: null });
    const wrong = await call("/api/svc/resumen-mensual", envFor(db), { token: "nope" });
    const unset = await call("/api/svc/deuda-ahorro-patrimonio", envFor(db, { token: null }), {
      token: TOKEN,
    });
    assert.equal(missing.status, 401);
    assert.equal(wrong.status, 401);
    assert.equal(unset.status, 401);
    const body = { error: "No autenticado" };
    assert.deepEqual(await missing.json(), body);
    assert.deepEqual(await wrong.json(), body);
    assert.deepEqual(await unset.json(), body);
    assert.equal(JSON.stringify(body).includes(TOKEN), false);
  });

  it("rejects POST with 405 and does not echo the token", async () => {
    const db = openDb();
    const res = await call("/api/svc/resumen-mensual", envFor(db), { method: "POST" });
    assert.equal(res.status, 405);
    const text = await res.text();
    assert.equal(text.includes(TOKEN), false);
    assert.match(text, /Método no permitido/);
    const bare = await call("/api/svc/ultimos-movimientos", envFor(db, { token: null }), {
      method: "POST",
      token: null,
    });
    assert.equal(bare.status, 405);
  });

  it("reads the three endpoints from fixtures and keeps bearer off the cookie API", async () => {
    const db = openDb();
    await seed(db);
    pinFx();
    const env = envFor(db);

    const resumenRes = await call("/api/svc/resumen-mensual?from=2026-08&to=2026-09", env, { token: TOKEN });
    assert.equal(resumenRes.status, 200);
    const resumen = (await resumenRes.json()) as {
      from: string;
      to: string;
      householdName: string;
      months: Array<{
        period: string;
        fxRate: number;
        ingresos: { ars: number; usd: number; totalArs: number };
        gastos: { ars: number; usd: number; totalArs: number };
        neto: { ars: number; usd: number; totalArs: number };
        topCategories: Array<{ name: string; slug: string; amount: number }>;
      }>;
    };
    assert.equal(resumen.householdName, "Personal");
    assert.deepEqual(
      resumen.months.map((month) => month.period),
      ["2026-08", "2026-09"],
    );
    const august = resumen.months[0];
    const september = resumen.months[1];
    assert.ok(august);
    assert.ok(september);
    assert.equal(august.fxRate, 1000);
    assert.deepEqual(august.ingresos, { ars: 200000, usd: 100, totalArs: 300000 });
    assert.deepEqual(august.gastos, { ars: 20500, usd: 20, totalArs: 40500 });
    assert.deepEqual(august.neto, { ars: 179500, usd: 80, totalArs: 259500 });
    assert.deepEqual(
      august.topCategories.map((row) => [row.name, row.amount]),
      [
        ["Cafe", 20000],
        ["Comida", 10000],
        ["Transporte", 4000],
        ["Salud", 3000],
        ["Ropa", 2000],
      ],
    );
    assert.equal(september.fxRate, 1100);
    assert.deepEqual(september.ingresos, { ars: 50000, usd: 0, totalArs: 50000 });
    assert.deepEqual(september.gastos, { ars: 3000, usd: 0, totalArs: 3000 });
    assert.deepEqual(september.neto, { ars: 47000, usd: 0, totalArs: 47000 });
    assert.deepEqual(september.topCategories, [{ name: "Alquiler", slug: "alquiler", amount: 3000 }]);

    const dashRes = await handleDashboard(
      new Request("https://cuentix.test/api/dashboard?period=2026-08"),
      env,
      luciano,
    );
    assert.equal(dashRes.status, 200);
    const dash = (await dashRes.json()) as {
      totalArs: number;
      incomeArs: number;
      categorySummary: Array<{ name: string; total: number }>;
    };
    assert.equal(dash.incomeArs, august.ingresos.totalArs);
    assert.equal(dash.totalArs, august.gastos.totalArs);
    assert.deepEqual(
      dash.categorySummary.map((row) => row.total),
      august.topCategories.slice(0, 4).map((row) => row.amount),
    );

    const wealthRes = await call("/api/svc/deuda-ahorro-patrimonio", env);
    assert.equal(wealthRes.status, 200);
    const wealth = (await wealthRes.json()) as {
      debt: {
        cardStatus: string;
        summary: {
          currentBalanceArs: number;
          currentBalanceUsd: number;
          settled: boolean;
          primaryCardLast4: string | null;
        };
      };
      savings: {
        totalArs: number;
        totalUsd: number;
        totalUsdBanks: number;
        totalUsdc: number;
        netArs: number;
      };
      patrimonio: {
        note: string;
        trustedMonths: string[];
        historyStartsAt: string | null;
        current: { netWorthArs: number | null; debtArs: number; assetsArs: number };
        changes: {
          vsPreviousMonth: { date: string; netWorthArs: number; deltaArs: number } | null;
          vsYearStart: { date: string; netWorthArs: number; deltaArs: number } | null;
        };
        series: unknown;
        flujo: unknown;
      };
    };
    const debtRes = await handleDebtStats(new Request("https://cuentix.test/api/stats/deuda"), env, luciano);
    const debtBody = (await debtRes.json()) as { cardStatus: string; summary: unknown };
    assert.equal(wealth.debt.cardStatus, debtBody.cardStatus);
    assert.deepEqual(wealth.debt.summary, debtBody.summary);
    assert.equal(wealth.debt.cardStatus, "activa");
    assert.equal(wealth.debt.summary.currentBalanceArs, 150000);
    assert.equal(wealth.debt.summary.currentBalanceUsd, 10);
    assert.equal(wealth.debt.summary.settled, false);
    assert.equal(wealth.debt.summary.primaryCardLast4, "4242");

    const ahorrosRes = await handleAhorros(new Request("https://cuentix.test/api/ahorros"), env, luciano);
    const ahorrosBody = (await ahorrosRes.json()) as { summary: unknown };
    assert.deepEqual(wealth.savings, ahorrosBody.summary);
    assert.equal(wealth.savings.totalArs, 500000);
    assert.equal(wealth.savings.totalUsdBanks, 100);
    assert.equal(wealth.savings.totalUsdc, 25);
    assert.equal(wealth.savings.totalUsd, 125);
    assert.equal(wealth.savings.netArs, 687500);

    const patRes = await handlePatrimonio(new Request("https://cuentix.test/api/patrimonio"), env, luciano);
    const patBody = (await patRes.json()) as Record<string, unknown>;
    const { changes, ...patrimonioRest } = wealth.patrimonio;
    assert.deepEqual(patrimonioRest, patBody);
    assert.equal(wealth.patrimonio.current.netWorthArs, 522500);
    assert.equal(wealth.patrimonio.current.assetsArs, 687500);
    assert.equal(wealth.patrimonio.current.debtArs, 150000);
    assert.equal(wealth.patrimonio.historyStartsAt, "2019-06-01");
    assert.equal(wealth.patrimonio.note, historyNote("2019-06-01"));
    assert.deepEqual(wealth.patrimonio.trustedMonths, []);
    const today = todayAr();
    const prevLate = `${shiftPeriod(today.slice(0, 7), -1)}-20`;
    const yearStart = `${today.slice(0, 4)}-01-01`;
    assert.equal(changes.vsPreviousMonth?.date, prevLate);
    assert.equal(changes.vsPreviousMonth?.netWorthArs, 400000);
    assert.equal(changes.vsPreviousMonth?.deltaArs, 522500 - 400000);
    if (yearStart < today) {
      assert.equal(changes.vsYearStart?.date, yearStart);
      assert.equal(changes.vsYearStart?.netWorthArs, 300000);
      assert.equal(changes.vsYearStart?.deltaArs, 522500 - 300000);
    } else {
      assert.equal(changes.vsYearStart, null);
    }

    const movesRes = await call("/api/svc/ultimos-movimientos", env);
    assert.equal(movesRes.status, 200);
    const moves = (await movesRes.json()) as {
      limit: number;
      total: number;
      movements: Array<{
        date: string;
        description: string;
        amountArs: number | null;
        amountUsd: number | null;
        category: string | null;
        bank: string | null;
        source: string;
        isPayment: boolean;
        ownership: string;
      }>;
    };
    assert.equal(moves.limit, 20);
    assert.equal(moves.movements.length, moves.total);
    const superRow = moves.movements.find((row) => row.description === "SUPER MERCADO");
    assert.ok(superRow);
    assert.deepEqual(superRow, {
      date: "2026-08-05",
      description: "SUPER MERCADO",
      amountArs: 10000,
      amountUsd: null,
      category: "Comida",
      bank: "Galicia",
      source: "manual",
      isPayment: false,
      ownership: "personal",
    });
    const pago = moves.movements.find((row) => row.description === "PAGO ALQUILER");
    assert.ok(pago);
    assert.equal(pago.isPayment, true);
    assert.equal(pago.ownership, "shared");
    assert.equal(pago.category, "Alquiler");
    assert.equal(pago.bank, "BBVA");
    assert.equal(
      moves.movements.some((row) => row.description === "GASTO AJENO" || row.description === "CASA SHARED"),
      false,
    );

    const one = await call("/api/svc/ultimos-movimientos?limit=1", env);
    const oneBody = (await one.json()) as { movements: Array<{ description: string }> };
    assert.equal(one.status, 200);
    assert.equal(oneBody.movements.length, 1);
    assert.equal(oneBody.movements[0]?.description, "PAGO ALQUILER");

    const augustMoves = await call("/api/svc/ultimos-movimientos?period=2026-08", env);
    const augustBody = (await augustMoves.json()) as { movements: Array<{ date: string; description: string }> };
    assert.equal(augustMoves.status, 200);
    assert.ok(augustBody.movements.some((row) => row.description === "SUPER MERCADO"));
    assert.equal(
      augustBody.movements.every((row) => row.date.startsWith("2026-08")),
      true,
    );

    const found = await call("/api/svc/ultimos-movimientos?q=SUPER", env);
    const foundBody = (await found.json()) as { movements: Array<{ description: string }> };
    assert.deepEqual(
      foundBody.movements.map((row) => row.description),
      ["SUPER MERCADO"],
    );

    const dumped = JSON.stringify({ resumen, wealth, moves, oneBody, augustBody, foundBody });
    assert.equal(dumped.includes(TOKEN), false);
    assert.equal(dumped.includes(WALLET), false);
    assert.equal(dumped.includes(RECEIPT_BLOB), false);
    assert.equal(dumped.includes("tx-super"), false);
    assert.equal(dumped.includes("rcpt-leak"), false);
    assert.equal(dumped.includes("user-luciano"), false);

    const dashBearer = await call("/api/dashboard", env);
    assert.equal(dashBearer.status, 401);
    assert.deepEqual(await dashBearer.json(), { error: "No autenticado" });

    const dashCookie = await call("/api/dashboard?period=2026-08", env, {
      token: null,
      cookie: `cuentix_session=${COOKIE}`,
    });
    assert.equal(dashCookie.status, 200);

    const svcCookieOnly = await call("/api/svc/deuda-ahorro-patrimonio", env, {
      token: null,
      cookie: `cuentix_session=${COOKIE}`,
    });
    assert.equal(svcCookieOnly.status, 401);

    const asOther = await call("/api/svc/deuda-ahorro-patrimonio", env, {
      cookie: `cuentix_session=${OTHER_COOKIE}`,
    });
    assert.equal(asOther.status, 200);
    const asOtherBody = (await asOther.json()) as { savings: { totalArs: number } };
    assert.equal(asOtherBody.savings.totalArs, 500000);

    const defaults = await call("/api/svc/resumen-mensual", env);
    const defaultsBody = (await defaults.json()) as { months: Array<{ period: string }> };
    assert.equal(defaults.status, 200);
    const current = todayAr().slice(0, 7);
    assert.equal(defaultsBody.months.length, 6);
    assert.equal(defaultsBody.months[5]?.period, current);
    assert.equal(defaultsBody.months[0]?.period, shiftPeriod(current, -5));
  });

  it("returns 400 for a bad month, an inverted range, and more than 24 months", async () => {
    const db = openDb();
    await seed(db);
    pinFx();
    const env = envFor(db);
    const bad = await call("/api/svc/resumen-mensual?from=2026-13&to=2026-14", env);
    const inverted = await call("/api/svc/resumen-mensual?from=2026-09&to=2026-08", env);
    const wide = await call("/api/svc/resumen-mensual?from=2024-01&to=2026-01", env);
    const half = await call("/api/svc/resumen-mensual?from=2026-08", env);
    const badPeriod = await call("/api/svc/ultimos-movimientos?period=2026-13", env);
    const badLimit = await call("/api/svc/ultimos-movimientos?limit=51", env);
    assert.equal(bad.status, 400);
    assert.equal(inverted.status, 400);
    assert.equal(wide.status, 400);
    assert.equal(half.status, 400);
    assert.equal(badPeriod.status, 400);
    assert.equal(badLimit.status, 400);
    assert.deepEqual(await bad.json(), { error: "Período inválido" });
    assert.deepEqual(await badPeriod.json(), { error: "Período inválido" });
    const limitBody = await badLimit.text();
    assert.equal(limitBody.includes(TOKEN), false);
  });

  it("uses MCP_SERVICE_USER_EMAIL when it is set", async () => {
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
    const res = await call(
      "/api/svc/deuda-ahorro-patrimonio",
      envFor(db, { email: "other@example.com" }),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { savings: { totalArs: number } };
    assert.equal(body.savings.totalArs, 42);
    assert.equal(JSON.stringify(body).includes(TOKEN), false);
  });
});
