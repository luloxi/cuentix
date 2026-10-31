import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expenseAmountText,
  isCalendarDate,
  manualFingerprintMaterial,
  parseExpenseAmount,
} from "./manual-expense";

describe("manual expense validation", () => {
  it("accepts a real calendar date and rejects month overflow", () => {
    assert.equal(isCalendarDate("2026-02-28"), true);
    assert.equal(isCalendarDate("2024-02-29"), true);
    assert.equal(isCalendarDate("2026-02-29"), false);
    assert.equal(isCalendarDate("2026-13-01"), false);
    assert.equal(isCalendarDate("2026-09-07T00:00:00"), false);
  });

  it("rejects non-finite and blank-looking junk amounts", () => {
    assert.deepEqual(parseExpenseAmount(""), { ok: true, amount: null });
    assert.deepEqual(parseExpenseAmount(null), { ok: true, amount: null });
    assert.deepEqual(parseExpenseAmount(12.5), { ok: true, amount: 12.5 });
    assert.deepEqual(parseExpenseAmount(-3), { ok: true, amount: 3 });
    assert.deepEqual(parseExpenseAmount("10.50"), { ok: true, amount: 10.5 });
    assert.equal(parseExpenseAmount("Infinity").ok, false);
    assert.equal(parseExpenseAmount("1e6").ok, false);
    assert.equal(parseExpenseAmount("10,50").ok, false);
    assert.equal(parseExpenseAmount(Number.NaN).ok, false);
  });

  it("stores cents as text and fingerprints without a clock", () => {
    assert.equal(expenseAmountText(10), "10.00");
    assert.equal(expenseAmountText(10.5), "10.50");
    assert.equal(expenseAmountText(null), null);
    const a = manualFingerprintMaterial({
      householdId: "hh",
      date: "2026-09-01",
      description: "  Café   doble ",
      amountArs: "10.00",
      amountUsd: null,
    });
    const b = manualFingerprintMaterial({
      householdId: "hh",
      date: "2026-09-01",
      description: "Café doble",
      amountArs: "10.00",
      amountUsd: null,
    });
    assert.equal(a, b);
    assert.equal(a.includes("Date"), false);
  });
});
