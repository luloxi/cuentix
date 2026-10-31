import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasSaldoDeuda,
  parseCardStatementSaldoFromText,
} from "./saldo-deuda";

describe("parseCardStatementSaldoFromText", () => {
  it("parses BBVA resumen SALDO ACTUAL line (ARS + USD)", () => {
    const text = `
CIERRE ACTUAL
SALDO ACTUAL $
SALDO ACTUAL U$S
SALDO ANTERIOR 2.848.046,36 64,62
TOTAL CONSUMOS DE TITULAR DEMO 42.689,91 5,23
SALDO ACTUAL 2.895.037,06 20,09
Total de cuotas a vencer SETIEMBRE/25
`;
    const saldo = parseCardStatementSaldoFromText(text);
    assert.ok(saldo);
    assert.equal(saldo!.ars, 2895037.06);
    assert.equal(saldo!.usd, 20.09);
  });

  it("accepts TOTAL A PAGAR", () => {
    const saldo = parseCardStatementSaldoFromText("TOTAL A PAGAR 150.000,50\n");
    assert.equal(saldo?.ars, 150000.5);
  });

  it("ignores CA$ checking balance lines", () => {
    const saldo = parseCardStatementSaldoFromText(
      "SALDO DISPONIBLE CA$ 1.234.567,89\nSALDO EN CUENTA 999.999,00\n",
    );
    assert.equal(saldo, null);
  });

  it("ignores SALDO ANTERIOR alone", () => {
    const saldo = parseCardStatementSaldoFromText(
      "SALDO ANTERIOR 2.848.046,36 64,62\n",
    );
    assert.equal(saldo, null);
  });
});

describe("hasSaldoDeuda", () => {
  it("is true when ARS or USD is set (including 0)", () => {
    assert.equal(hasSaldoDeuda({ saldoDeudaArs: 0 }), true);
    assert.equal(hasSaldoDeuda({ saldoDeudaUsd: 10 }), true);
    assert.equal(hasSaldoDeuda({}), false);
    assert.equal(hasSaldoDeuda(null), false);
  });
});
