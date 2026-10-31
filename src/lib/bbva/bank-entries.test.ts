import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isBankAccountingEntry,
  isCardPaymentEntry,
  isInternalTransferDescription,
  isNonIncomeTransferLabel,
  isOwnAccountTransferDescription,
  isOwnFxConversionDescription,
  isTransferenciaInternaTipo,
} from "@/lib/bbva/bank-entries";

describe("isBankAccountingEntry internal transfers", () => {
  it("skips own-account / internal transfer descriptions", () => {
    for (const d of [
      "TRANSFERENCIA ENTRE CUENTAS",
      "TRANSF A CUENTA PROPIA",
      "DEB CTA A CTA",
      "TRANSFERENCIA INTERNA ARS",
      "A una cuenta tuya",
      "De una cuenta tuya",
      "A UNA CUENTA TUYA",
      "De una cuenta tuya (Fiwind)",
    ]) {
      assert.equal(isOwnAccountTransferDescription(d), true, d);
      assert.equal(isBankAccountingEntry(d), true, d);
      assert.equal(isNonIncomeTransferLabel(d), true, d);
    }
  });

  it("Rainman: FX Cambio de moneda is Transferencia interna (never Ingresos)", () => {
    for (const d of [
      "Cambio de moneda",
      "CAMBIO DE MONEDA USD/ARS",
      "BBVA CA$ Cambio de moneda extranjera",
      "Operacion de cambio",
      "COMPRA ME USD",
    ]) {
      assert.equal(isOwnFxConversionDescription(d), true, d);
      assert.equal(isInternalTransferDescription(d), true, d);
      assert.equal(isNonIncomeTransferLabel(d), true, d);
      assert.equal(isBankAccountingEntry(d), true, d);
    }
  });

  it("Rainman: Transferencia inmediata (800k / 1.9M) is internal, not Ingresos", () => {
    for (const d of [
      "Transferencia inmediata",
      "BBVA CA$ Transferencia inmediata",
      "BBVA CA$ TRANSFERENCIA INMEDIATA",
    ]) {
      assert.equal(isInternalTransferDescription(d), true, d);
      assert.equal(isNonIncomeTransferLabel(d), true, d);
    }
  });

  it("Rainman: bare BBVA TRANSFERENCIA (306k / 200k) is internal", () => {
    for (const d of [
      "BBVA CA$ TRANSFERENCIA",
      "BBVA CA$ TRANSFERENCIA 306333.80",
      "TRANSFERENCIA",
    ]) {
      assert.equal(isInternalTransferDescription(d), true, d);
      assert.equal(isNonIncomeTransferLabel(d), true, d);
    }
  });

  it("Rainman: TRANSF. CLIENTE CTA. CAP is internal (566k)", () => {
    const d =
      "BBVA CA$ TRANSF. CLIENTE CTA. CAP093 380138 5 Nro:00010008";
    assert.equal(isInternalTransferDescription(d), true, d);
    assert.equal(isNonIncomeTransferLabel(d), true, d);
  });

  it("Rainman: BBNK self transfer is internal (not Ingresos)", () => {
    const d = "TRANSFERENCIA BBNK 306333.80";
    assert.equal(isInternalTransferDescription(d), true, d);
    assert.equal(isNonIncomeTransferLabel(d), true, d);
  });

  it("Rainman: same CUIT twice → interno; titular CUIT on transfer → interno", () => {
    const same =
      "TRANSFERENCIA DE 20-30111222-3 A 20-30111222-3 CUENTA SUELDO";
    assert.equal(isInternalTransferDescription(same), true, same);
    const holder = "TRANSFERENCIA RECIBIDA CUIT 20301112223";
    assert.equal(
      isInternalTransferDescription(holder, { holderCuit: "20-30111222-3" }),
      true,
      holder,
    );
  });

  it("Rainman: DEBIN / PAGO VISA are payments (not income)", () => {
    assert.equal(isCardPaymentEntry("DEBIN VISA ****1234"), true);
    assert.equal(isNonIncomeTransferLabel("DEBIN PAGO TARJETA"), true);
    assert.equal(isCardPaymentEntry("PAGO VISA"), true);
  });

  it("Rainman: BBVA CR TRF / CR TBE / INM COE ($300k) is Transferencia interna", () => {
    for (const d of [
      "BBVA CA$ CR TRF INM COE Nro:937250",
      "BBVA CA$ CR TBE INM COE",
      "CR TBE INM COE",
      "CR TRF INM COE Nro:937250",
      "BBVA CA$ CR TBE",
      "BBVA CA$ CR TRF",
      "INM COE Nro:1",
    ]) {
      assert.equal(isInternalTransferDescription(d), true, d);
      assert.equal(isNonIncomeTransferLabel(d), true, d);
      assert.equal(isBankAccountingEntry(d), true, d);
    }
  });

  it("keeps real spends and named third-party income (Mauro)", () => {
    assert.equal(isOwnAccountTransferDescription("COMPRA SUPER ARS"), false);
    assert.equal(isBankAccountingEntry("COMPRA SUPER ARS"), false);
    assert.equal(isBankAccountingEntry("TRANSFERENCIA A JUAN PEREZ"), false);
    assert.equal(isOwnAccountTransferDescription("Pago a DIA"), false);
    assert.equal(isNonIncomeTransferLabel("Mauro Agustin Andreoli"), false);
    assert.equal(
      isInternalTransferDescription("Transferencia de Mauro Agustin Andreoli"),
      false,
    );
  });

  it("Tipo Transferencia interna matches category slug", () => {
    assert.equal(
      isTransferenciaInternaTipo(true, {
        slug: "transferencia-interna",
        name: "Transferencia interna",
      }),
      true,
    );
    assert.equal(
      isTransferenciaInternaTipo(false, {
        slug: "transferencia-interna",
        name: "Transferencia interna",
      }),
      false,
    );
    assert.equal(
      isTransferenciaInternaTipo(true, { slug: "luz", name: "Luz" }),
      false,
    );
  });

  it("Tipo by description without category (Consumos visible path)", () => {
    assert.equal(
      isTransferenciaInternaTipo(true, null, "CR TBE INM COE"),
      true,
    );
    assert.equal(
      isTransferenciaInternaTipo(true, { slug: null }, "A una cuenta tuya"),
      true,
    );
    assert.equal(
      isTransferenciaInternaTipo(false, null, "CR TBE INM COE"),
      false,
    );
  });
});
