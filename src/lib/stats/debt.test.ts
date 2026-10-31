import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseStatementWorkbook } from "@/lib/bbva/parse";
import {
  filterToPrimaryCard,
  pickPrimaryCardLast4,
} from "@/lib/bbva/card-account";
import { parseStatementFile } from "@/lib/import/parse-statement";
import { isPeriodDebtSource } from "@/lib/import/source";
import { logicalExpenseKey } from "@/lib/import/dedupe";
import { isExpenseRow } from "@/lib/stats/monthly-expenses";
import {
  computeCardDebt,
  groupOpenInstallments,
  INCOMPLETE_LEDGER_ARS,
  parseInstallment,
  type DebtTx,
} from "./debt";

const FIX = join(process.cwd(), "fixtures/bbva-card");

function buf(name: string) {
  return readFileSync(join(FIX, name));
}

function asTx(
  m: {
    date: string;
    descriptionNormalized: string;
    amountArs: number | null;
    amountUsd: number | null;
    installment: string | null;
    isPayment: boolean;
    isCredit: boolean;
    cardLast4?: string | null;
    fingerprint?: string;
  },
  source: string,
  id: string,
): DebtTx {
  return {
    id,
    date: m.date,
    descriptionNormalized: m.descriptionNormalized,
    amountArs: m.amountArs,
    amountUsd: m.amountUsd,
    installment: m.installment,
    isPayment: m.isPayment,
    isCredit: m.isCredit,
    ownership: "personal",
    paidByUserId: "user-1",
    source,
    bank: "BBVA",
    cardLast4: m.cardLast4 ?? null,
  };
}

describe("parseInstallment", () => {
  it("keeps real cuotas and drops empties / tax codes", () => {
    assert.deepEqual(parseInstallment("4/6"), { current: 4, total: 6 });
    assert.equal(parseInstallment("/"), null);
    assert.equal(parseInstallment("-"), null);
    assert.equal(parseInstallment("5463/5465"), null);
  });
});

describe("BBVA period fixtures — his card only", () => {
  it("tags both last4s and picks 8958 (TEMBICI / GROK), not Penguin 7022", () => {
    const parsed = parseStatementWorkbook(buf("mov-periodo-a.xls"), "mov-periodo-a.xls");
    assert.equal(parsed.layout, "period");
    const last4 = new Set(parsed.movements.map((m) => m.cardLast4).filter(Boolean));
    assert.deepEqual([...last4].sort(), ["7022", "8958"]);

    const penguin = parsed.movements.find((m) => /PENGUIN/i.test(m.descriptionNormalized));
    assert.equal(penguin?.cardLast4, "7022");
    assert.equal(penguin?.installment, "4/6");

    const tem = parsed.movements.find((m) => /TEMBICI/i.test(m.descriptionNormalized));
    assert.equal(tem?.cardLast4, "8958");

    const primary = pickPrimaryCardLast4(parsed.movements);
    assert.equal(primary, "8958");
    const mine = filterToPrimaryCard(parsed.movements, primary);
    assert.equal(mine.some((m) => /PENGUIN/i.test(m.descriptionNormalized)), false);
    assert.equal(mine.some((m) => /TEMBICI/i.test(m.descriptionNormalized)), true);
    assert.ok(mine.length < parsed.movements.length);
  });

  it("period xls is bbva_period and does not count as gastos neta", async () => {
    const parsed = await parseStatementFile(buf("mov-periodo-a.xls"), "mov-periodo-a.xls");
    assert.equal(parsed.source, "bbva_period");
    assert.equal(isPeriodDebtSource(parsed.source), true);
    const expenses = parsed.movements.filter((m) =>
      isExpenseRow({ ...m, source: parsed.source }),
    );
    assert.equal(expenses.length, 0);
  });
});

describe("Últimos movimientos snapshot", () => {
  it("reads TEMBICI + SU PAGO from the latest export", () => {
    const parsed = parseStatementWorkbook(
      buf("ultimos-movimientos.xlsx"),
      "ultimos-movimientos.xlsx",
    );
    assert.equal(parsed.layout, "ultimos");
    const tem = parsed.movements.filter((m) => /TEMBICI/i.test(m.descriptionNormalized));
    assert.equal(tem.length, 2);
    const pay = parsed.movements.filter((m) => m.isPayment);
    assert.ok(pay.length >= 2);
    const temArs = tem.reduce((s, m) => s + Math.abs(m.amountArs ?? 0), 0);
    assert.equal(temArs, 280);
  });
});

describe("computeCardDebt — no millions", () => {
  it("combined fixtures stay under 10k and keep TEMBICI", async () => {
    const files = [
      ["mov-periodo-a.xls", "mov-periodo-a.xls"],
      ["mov-periodo-b.xls", "mov-periodo-b.xls"],
      ["mov-periodo-c.xls", "mov-periodo-c.xls"],
      ["ultimos-movimientos.xlsx", "ultimos-movimientos.xlsx"],
      ["ultimos-movimientos-2.xlsx", "ultimos-movimientos-2.xlsx"],
    ] as const;

    const rows: DebtTx[] = [];
    let ledgerCharges = 0;
    for (const [file, name] of files) {
      const parsed = await parseStatementFile(buf(file), name);
      const primary = pickPrimaryCardLast4(parsed.movements);
      const mine = filterToPrimaryCard(parsed.movements, primary);
      for (const m of mine) {
        if (
          !m.isPayment &&
          !m.isCredit &&
          isExpenseRow({ ...m, source: "bbva_import" })
        ) {
          ledgerCharges += Math.abs(m.amountArs ?? 0);
        }
        rows.push(asTx(m, parsed.source, `${name}|${m.fingerprint}`));
      }
    }

    assert.ok(
      ledgerCharges > 1_000_000,
      `old ledger of period+ultimos should be millions, got ${ledgerCharges}`,
    );

    // Without saldo_deuda → Sin snapshot (never invent from TEMBICI / CA).
    const emptyDebt = computeCardDebt(rows, { userId: "user-1" });
    assert.equal(emptyDebt.mode, "empty");
    assert.equal(emptyDebt.currentBalanceArs, 0);
    assert.equal(emptyDebt.settled, false);
    assert.ok(
      emptyDebt.openCharges.some((c) => /TEMBICI/i.test(c.description)),
      "TEMBICI still listed as open charge context",
    );
    assert.equal(
      emptyDebt.openInstallments.some((p) => /PENGUIN/i.test(p.description)),
      false,
      "other card 4/6 must not leak into his debt",
    );

    // With saldo_deuda → that amount is the hero (Rainman SoT).
    const debt = computeCardDebt(rows, {
      userId: "user-1",
      settings: { saldoDeudaArs: 4200, saldoDeudaUsd: null },
    });
    assert.equal(debt.mode, "manual");
    assert.equal(debt.currentBalanceArs, 4200);
    assert.equal(debt.saldoSnapshotArs, 4200);
    assert.equal(debt.netDebtArs, 4200);
    assert.equal(debt.forceSettled, false);
    assert.equal(debt.settled, false);
    assert.ok(debt.currentBalanceArs < INCOMPLETE_LEDGER_ARS);
    assert.ok(
      debt.totalPaidArs < 1_000_000,
      `Pagado must be the 21d snapshot window, not lifetime, got ${debt.totalPaidArs}`,
    );
  });

  it("forceSettled zeros home / deuda even if TEMBICI is there", async () => {
    const parsed = await parseStatementFile(
      buf("ultimos-movimientos.xlsx"),
      "ultimos-movimientos.xlsx",
    );
    const rows = parsed.movements.map((m, i) =>
      asTx(m, parsed.source, String(i)),
    );
    const debt = computeCardDebt(rows, {
      userId: "user-1",
      settings: { forceSettled: true },
    });
    assert.equal(debt.currentBalanceArs, 0);
    assert.equal(debt.settled, true);
    assert.equal(debt.forceSettled, true);
  });

  it("period files alone are not false Saldada without a snapshot", async () => {
    const parsed = await parseStatementFile(
      buf("mov-periodo-a.xls"),
      "mov-periodo-a.xls",
    );
    const primary = pickPrimaryCardLast4(parsed.movements);
    const mine = filterToPrimaryCard(parsed.movements, primary);
    const rows = mine.map((m, i) => asTx(m, parsed.source, String(i)));
    const open = groupOpenInstallments(rows);
    assert.equal(
      open.some((p) => /PENGUIN/i.test(p.description)),
      false,
    );
    const debt = computeCardDebt(rows, { userId: "user-1" });
    assert.equal(debt.currentBalanceArs, 0);
    assert.equal(debt.settled, false);
    assert.equal(debt.mode, "empty");
  });

  it("TEMBICI 140 from ultimos without last4 is an open charge, not settled", () => {
    const rows: DebtTx[] = [
      asTx(
        {
          date: "2026-05-06",
          descriptionNormalized: "PENGUIN GALERIAS PACIF",
          amountArs: 39000,
          amountUsd: null,
          installment: "4/6",
          isPayment: false,
          isCredit: false,
          cardLast4: "7022",
        },
        "bbva_period",
        "penguin",
      ),
      asTx(
        {
          date: "2026-08-23",
          descriptionNormalized: "MERPAGO*TEMBICI",
          amountArs: 140,
          amountUsd: null,
          installment: null,
          isPayment: false,
          isCredit: false,
          cardLast4: null,
        },
        "bbva_xlsx",
        "tembici",
      ),
    ];
    const debt = computeCardDebt(rows, {
      userId: "user-1",
      settings: { cardLast4: "8958", saldoDeudaArs: 140 },
    });
    assert.equal(debt.mode, "manual");
    assert.equal(debt.settled, false);
    assert.equal(debt.currentBalanceArs, 140);
    assert.equal(debt.openCharges.length, 1);
    assert.match(debt.openCharges[0]!.description, /TEMBICI/i);
    assert.equal(
      debt.openInstallments.some((p) => /PENGUIN/i.test(p.description)),
      false,
    );
  });

  it("keeps TEMBICI even if import stamped the other last4", () => {
    const rows: DebtTx[] = [
      asTx(
        {
          date: "2026-08-23",
          descriptionNormalized: "MERPAGO*TEMBICI",
          amountArs: 140,
          amountUsd: null,
          installment: null,
          isPayment: false,
          isCredit: false,
          cardLast4: "7022",
        },
        "bbva_xlsx",
        "tembici-stamped",
      ),
      asTx(
        {
          date: "2026-08-22",
          descriptionNormalized: "GROK XAI",
          amountArs: 10,
          amountUsd: null,
          installment: "3/3",
          isPayment: false,
          isCredit: false,
          cardLast4: "8958",
        },
        "bbva_period",
        "grok",
      ),
    ];
    const debt = computeCardDebt(rows, {
      userId: "user-1",
      settings: { cardLast4: "8958", saldoDeudaArs: 140 },
    });
    assert.equal(debt.settled, false);
    assert.ok(debt.openCharges.some((c) => /TEMBICI/i.test(c.description)));
    assert.equal(debt.currentBalanceArs, 140);
  });

  it("1.2M lifetime payments stay out of totalPaid (21d snapshot only)", () => {
    const rows: DebtTx[] = [
      asTx(
        {
          date: "2025-01-15",
          descriptionNormalized: "SU PAGO EN PESOS",
          amountArs: -1_200_000,
          amountUsd: null,
          installment: null,
          isPayment: true,
          isCredit: false,
          cardLast4: "8958",
        },
        "bbva_period",
        "old-pay",
      ),
      asTx(
        {
          date: "2025-03-01",
          descriptionNormalized: "SU PAGO EN PESOS",
          amountArs: -8_000_000,
          amountUsd: null,
          installment: null,
          isPayment: true,
          isCredit: false,
          cardLast4: null,
        },
        "bbva_xlsx",
        "old-snap-pay",
      ),
      asTx(
        {
          date: "2026-08-20",
          descriptionNormalized: "SU PAGO EN PESOS",
          amountArs: -5000,
          amountUsd: null,
          installment: null,
          isPayment: true,
          isCredit: false,
          cardLast4: null,
        },
        "bbva_xlsx",
        "recent-pay",
      ),
      asTx(
        {
          date: "2026-08-23",
          descriptionNormalized: "MERPAGO*TEMBICI",
          amountArs: 140,
          amountUsd: null,
          installment: null,
          isPayment: false,
          isCredit: false,
          cardLast4: null,
        },
        "bbva_xlsx",
        "tembici",
      ),
    ];
    // Without saldo → empty hero; charges still listed.
    const bare = computeCardDebt(rows, { userId: "user-1" });
    assert.equal(bare.mode, "empty");
    assert.equal(bare.currentBalanceArs, 0);
    assert.ok(bare.openCharges.some((c) => /TEMBICI/i.test(c.description)));

    const debt = computeCardDebt(rows, {
      userId: "user-1",
      settings: { saldoDeudaArs: 140 },
    });
    assert.equal(debt.mode, "manual");
    assert.equal(debt.currentBalanceArs, 140);
    assert.equal(debt.settled, false);
    assert.equal(debt.totalPaidArs, 5000);
    assert.ok(debt.totalPaidArs < 1_000_000);
    assert.ok(!debt.payments.some((p) => Math.abs(p.amountArs ?? 0) >= 1_000_000));
    assert.ok(debt.openCharges.some((c) => /TEMBICI/i.test(c.description)));
  });

  it("empty without snapshot is not false Saldada", () => {
    const debt = computeCardDebt([], { userId: "user-1" });
    assert.equal(debt.mode, "empty");
    assert.equal(debt.settled, false);
    assert.equal(debt.forceSettled, false);
    assert.equal(debt.currentBalanceArs, 0);
    assert.equal(debt.totalPaidArs, 0);
    assert.equal(debt.openCharges.length, 0);
  });

  it("CR TBE bank CA noise never invents debt; saldo_deuda is SoT", () => {
    const rows: DebtTx[] = [
      asTx(
        {
          date: "2026-09-19",
          descriptionNormalized: "CR TBE INM COE",
          amountArs: 300000,
          amountUsd: null,
          installment: null,
          isPayment: true,
          isCredit: false,
          cardLast4: null,
        },
        "bbva_import",
        "cr-tbe",
      ),
      asTx(
        {
          date: "2026-08-23",
          descriptionNormalized: "MERPAGO*TEMBICI",
          amountArs: 140,
          amountUsd: null,
          installment: null,
          isPayment: false,
          isCredit: false,
          cardLast4: null,
        },
        "bbva_xlsx",
        "tembici",
      ),
      asTx(
        {
          date: "2026-08-20",
          descriptionNormalized: "SU PAGO EN PESOS",
          amountArs: -5000,
          amountUsd: null,
          installment: null,
          isPayment: true,
          isCredit: false,
          cardLast4: null,
        },
        "bbva_xlsx",
        "recent-pay",
      ),
    ];
    // No saldo_deuda → Sin snapshot (do not invent 140 from TEMBICI).
    const bare = computeCardDebt(rows, { userId: "user-1" });
    assert.equal(bare.mode, "empty");
    assert.equal(bare.currentBalanceArs, 0);
    assert.equal(bare.saldoSnapshotArs, 0);
    assert.ok(bare.openCharges.some((c) => /TEMBICI/i.test(c.description)));
    assert.equal(
      bare.payments.some((p) => /CR TBE/i.test(p.description)),
      false,
      "internal CR TBE must not count as card Pagado",
    );

    // User / import filled saldo_deuda → that is the debt.
    const debt = computeCardDebt(rows, {
      userId: "user-1",
      settings: { saldoDeudaArs: 2895037.06, saldoDeudaUsd: 20.09 },
    });
    assert.equal(debt.mode, "manual");
    assert.equal(debt.currentBalanceArs, 2895037.06);
    assert.equal(debt.currentBalanceUsd, 20.09);
    assert.equal(debt.saldoSnapshotArs, 2895037.06);
    assert.equal(debt.netDebtArs, 2895037.06);
    assert.equal(debt.settled, false);
  });

  it("debt window is not anchored on CR TBE for Pagado list", () => {
    const rows: DebtTx[] = [
      asTx(
        {
          date: "2026-09-19",
          descriptionNormalized: "CR TBE INM COE",
          amountArs: 300000,
          amountUsd: null,
          installment: null,
          isPayment: true,
          isCredit: false,
          cardLast4: null,
        },
        "bbva_import",
        "cr-tbe",
      ),
      asTx(
        {
          date: "2026-08-20",
          descriptionNormalized: "SU PAGO EN PESOS",
          amountArs: -5000,
          amountUsd: null,
          installment: null,
          isPayment: true,
          isCredit: false,
          cardLast4: null,
        },
        "bbva_xlsx",
        "recent-pay",
      ),
      asTx(
        {
          date: "2026-08-23",
          descriptionNormalized: "MERPAGO*TEMBICI",
          amountArs: 140,
          amountUsd: null,
          installment: null,
          isPayment: false,
          isCredit: false,
          cardLast4: null,
        },
        "bbva_xlsx",
        "tembici",
      ),
    ];
    const debt = computeCardDebt(rows, {
      userId: "user-1",
      settings: { saldoDeudaArs: 140 },
    });
    assert.equal(debt.totalPaidArs, 5000);
    assert.equal(
      debt.payments.some((p) => /CR TBE/i.test(p.description)),
      false,
    );
  });
});

describe("strict dedupe", () => {
  it("re-reading the same period file yields the same logical keys", () => {
    const a = parseStatementWorkbook(buf("mov-periodo-a.xls"), "mov-periodo-a.xls");
    const b = parseStatementWorkbook(buf("mov-periodo-a.xls"), "mov-periodo-a.xls");
    const keysA = a.movements.map((m) => logicalExpenseKey(m)).sort();
    const keysB = b.movements.map((m) => logicalExpenseKey(m)).sort();
    assert.deepEqual(keysA, keysB);
    const fps = new Set(a.movements.map((m) => m.fingerprint));
    assert.equal(fps.size, a.movements.length);
  });
});
