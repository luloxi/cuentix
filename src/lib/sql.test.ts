import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import {
  WEEK_BUCKET_SQL,
  balanceTotalsSql,
  incomeByMonthQuery,
  latestBalancesSql,
  spendingByCategoryQuery,
  spendingSeriesQuery,
} from "./sql";
import { insertAccount, insertCategory, insertTransaction, openMemoryDb } from "../test/db";

function rowsOf(db: DatabaseSync, sql: string, params: Array<string | number | null> = []) {
  return db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
}

function ledger() {
  const db = openMemoryDb();
  const fiwind = insertAccount(db, "Fiwind");
  const bbva = insertAccount(db, "BBVA caja");
  const delivery = insertCategory(db, "Delivery");
  const income = insertCategory(db, "Ingreso");
  const transfer = insertCategory(db, "Transferencia interna");
  const yieldCat = insertCategory(db, "Rendimientos");
  return { db, fiwind, bbva, delivery, income, transfer, yieldCat };
}

describe("spending SQL", () => {
  it("excludes internal transfers and income, and nets refunds", () => {
    const { db, fiwind, delivery, income, transfer } = ledger();
    insertTransaction(db, {
      date: "2026-06-01",
      amount: 100,
      currency: "ARS",
      accountId: fiwind,
      categoryId: delivery,
      description: "Test purchase A",
      kind: "expense",
    });
    insertTransaction(db, {
      date: "2026-06-02",
      amount: -30,
      currency: "ARS",
      accountId: fiwind,
      categoryId: delivery,
      description: "Test refund A",
      kind: "expense",
    });
    insertTransaction(db, {
      date: "2026-06-02",
      amount: 500,
      currency: "ARS",
      accountId: fiwind,
      categoryId: income,
      description: "Test salary",
      kind: "income",
    });
    insertTransaction(db, {
      date: "2026-06-02",
      amount: 999,
      currency: "ARS",
      accountId: fiwind,
      categoryId: transfer,
      description: "Test own transfer",
      kind: "internal_transfer",
    });
    const query = spendingByCategoryQuery("ARS", "2026-06-15", 90);
    const rows = rowsOf(db, query.sql, query.params);
    expect(rows).toEqual([{ category: "Delivery", count: 2, total: 70 }]);
  });

  it("includes day 90 and excludes day 91", () => {
    const { db, fiwind, delivery } = ledger();
    insertTransaction(db, {
      date: "2026-03-16",
      amount: 5,
      currency: "ARS",
      accountId: fiwind,
      categoryId: delivery,
      description: "Test day 91",
      kind: "expense",
    });
    insertTransaction(db, {
      date: "2026-03-17",
      amount: 8,
      currency: "ARS",
      accountId: fiwind,
      categoryId: delivery,
      description: "Test day 90",
      kind: "expense",
    });
    insertTransaction(db, {
      date: "2026-06-15",
      amount: 2,
      currency: "ARS",
      accountId: fiwind,
      categoryId: delivery,
      description: "Test today",
      kind: "expense",
    });
    insertTransaction(db, {
      date: "2026-06-16",
      amount: 9,
      currency: "ARS",
      accountId: fiwind,
      categoryId: delivery,
      description: "Test tomorrow",
      kind: "expense",
    });
    const query = spendingByCategoryQuery("ARS", "2026-06-15");
    expect(query.params).toContain("-90 days");
    const rows = rowsOf(db, query.sql, query.params);
    expect(rows).toEqual([{ category: "Delivery", count: 2, total: 10 }]);
  });

  it("never sums ARS with USDT", () => {
    const { db, fiwind, delivery } = ledger();
    insertTransaction(db, {
      date: "2026-06-01",
      amount: 10,
      currency: "ARS",
      accountId: fiwind,
      categoryId: delivery,
      description: "Test pesos",
      kind: "expense",
    });
    insertTransaction(db, {
      date: "2026-06-01",
      amount: 4,
      currency: "USDT",
      accountId: fiwind,
      categoryId: delivery,
      description: "Test tether",
      kind: "expense",
    });
    const ars = spendingByCategoryQuery("ARS", "2026-06-15");
    const usdt = spendingByCategoryQuery("USDT", "2026-06-15");
    expect(rowsOf(db, ars.sql, ars.params)).toEqual([{ category: "Delivery", count: 1, total: 10 }]);
    expect(rowsOf(db, usdt.sql, usdt.params)).toEqual([{ category: "Delivery", count: 1, total: 4 }]);
  });
});

describe("income SQL", () => {
  it("counts only kind=income", () => {
    const { db, fiwind, delivery, income, transfer, yieldCat } = ledger();
    insertTransaction(db, {
      date: "2026-05-02",
      amount: 200,
      currency: "ARS",
      accountId: fiwind,
      categoryId: income,
      description: "Test client payment",
      kind: "income",
    });
    insertTransaction(db, {
      date: "2026-06-01",
      amount: 15,
      currency: "ARS",
      accountId: fiwind,
      categoryId: yieldCat,
      description: "Test yield",
      kind: "income",
    });
    insertTransaction(db, {
      date: "2026-06-01",
      amount: 80,
      currency: "ARS",
      accountId: fiwind,
      categoryId: delivery,
      description: "Test purchase B",
      kind: "expense",
    });
    insertTransaction(db, {
      date: "2026-06-01",
      amount: 400,
      currency: "ARS",
      accountId: fiwind,
      categoryId: transfer,
      description: "Test internal",
      kind: "internal_transfer",
    });
    insertTransaction(db, {
      date: "2026-06-01",
      amount: 3,
      currency: "USD",
      accountId: fiwind,
      categoryId: income,
      description: "Test usd income",
      kind: "income",
    });
    const query = incomeByMonthQuery("ARS");
    expect(rowsOf(db, query.sql, query.params)).toEqual([
      { month: "2026-05", count: 1, total: 200 },
      { month: "2026-06", count: 1, total: 15 },
    ]);
  });
});

describe("spending series SQL", () => {
  it("groups weeks from Monday across the year boundary", () => {
    expect(WEEK_BUCKET_SQL).toBe("date(t.date, 'weekday 0', '-6 days')");
    const { db, fiwind, delivery, income, transfer } = ledger();
    const expense = (date: string, amount: number, currency = "ARS", kind = "expense") =>
      insertTransaction(db, {
        date,
        amount,
        currency,
        accountId: fiwind,
        categoryId: kind === "income" ? income : kind === "internal_transfer" ? transfer : delivery,
        description: `Test ${kind} ${date} ${currency}`,
        kind,
      });
    expense("2025-12-31", 10);
    expense("2026-01-01", 5);
    expense("2026-01-04", 1);
    expense("2026-01-05", 7);
    expense("2026-01-05", 100, "ARS", "income");
    expense("2026-01-05", 50, "ARS", "internal_transfer");
    expense("2026-01-05", 3, "USDT");
    const query = spendingSeriesQuery("ARS", "2026-01-20", "week");
    expect(rowsOf(db, query.sql, query.params)).toEqual([
      { bucket: "2025-12-29", count: 3, total: 16 },
      { bucket: "2026-01-05", count: 1, total: 7 },
    ]);
  });

  it("groups months, and all-history keeps months outside the 24 month window", () => {
    const { db, fiwind, delivery } = ledger();
    insertTransaction(db, {
      date: "2020-05-03",
      amount: 4,
      currency: "ARS",
      accountId: fiwind,
      categoryId: delivery,
      description: "Test old purchase",
      kind: "expense",
    });
    insertTransaction(db, {
      date: "2025-12-31",
      amount: 2,
      currency: "ARS",
      accountId: fiwind,
      categoryId: delivery,
      description: "Test december",
      kind: "expense",
    });
    insertTransaction(db, {
      date: "2026-01-02",
      amount: 6,
      currency: "ARS",
      accountId: fiwind,
      categoryId: delivery,
      description: "Test january",
      kind: "expense",
    });
    const month = spendingSeriesQuery("ARS", "2026-03-01", "month");
    expect(rowsOf(db, month.sql, month.params)).toEqual([
      { bucket: "2025-12", count: 1, total: 2 },
      { bucket: "2026-01", count: 1, total: 6 },
    ]);
    const all = spendingSeriesQuery("ARS", "2026-03-01", "all");
    expect(rowsOf(db, all.sql, all.params)).toEqual([
      { bucket: "2020-05", count: 1, total: 4 },
      { bucket: "2025-12", count: 1, total: 2 },
      { bucket: "2026-01", count: 1, total: 6 },
    ]);
  });
});

describe("balance SQL", () => {
  it("returns the latest snapshot per account and currency, summed apart", () => {
    const db = openMemoryDb();
    const fiwind = insertAccount(db, "Fiwind");
    const bbva = insertAccount(db, "BBVA caja");
    const insert = db.prepare(
      `INSERT INTO balance_snapshots (date, account_id, currency, amount, source) VALUES (?, ?, ?, ?, 'manual')`,
    );
    insert.run("2026-01-01", fiwind, "ARS", 10);
    insert.run("2026-02-01", fiwind, "ARS", 12);
    insert.run("2026-03-01", fiwind, "USDT", 5);
    insert.run("2026-02-15", bbva, "ARS", 3);
    expect(rowsOf(db, latestBalancesSql)).toEqual([
      { account: "BBVA caja", currency: "ARS", amount: 3, date: "2026-02-15", source: "manual" },
      { account: "Fiwind", currency: "ARS", amount: 12, date: "2026-02-01", source: "manual" },
      { account: "Fiwind", currency: "USDT", amount: 5, date: "2026-03-01", source: "manual" },
    ]);
    expect(rowsOf(db, balanceTotalsSql)).toEqual([
      { currency: "ARS", total: 15 },
      { currency: "USDT", total: 5 },
    ]);
  });
});
