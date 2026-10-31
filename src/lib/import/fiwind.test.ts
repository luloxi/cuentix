import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchCategory } from "@/lib/categorize/rules";
import { isBankAccountingEntry, isCardPaymentEntry } from "@/lib/bbva/bank-entries";
import { isExpenseRow } from "@/lib/stats/monthly-expenses";
import {
  categoryHintForFiwindKind,
  classifyFiwindTipo,
  conversionPairedWithSpend,
  exactFiwindMerchantSlug,
  extractFiwindMerchant,
  flagsForFiwindKind,
  isDustYield,
  isFiwindNonExpenseTipo,
  isFiwindNumericTipo,
  isFiwindWalletTransferTipo,
  reclassifyTargetForDescription,
} from "@/lib/import/fiwind";

describe("Fiwind Tipo classification", () => {
  it("splits conversions, crypto, yields, deposits and real spends", () => {
    assert.equal(classifyFiwindTipo("Conversión"), "conversion");
    assert.equal(classifyFiwindTipo("Compra KO"), "investment");
    assert.equal(classifyFiwindTipo("Venta KO"), "investment");
    assert.equal(classifyFiwindTipo("Ganancia diaria"), "yield");
    assert.equal(classifyFiwindTipo("Rendimiento bonificado"), "yield");
    assert.equal(classifyFiwindTipo("Depósito de cuenta propia"), "deposit");
    assert.equal(classifyFiwindTipo("Devolución de RAPPI"), "refund");
    assert.equal(classifyFiwindTipo("Retiro"), "crypto_out");
    assert.equal(classifyFiwindTipo("Pago a DIA"), "spend");
    assert.equal(classifyFiwindTipo("Retiro a Elena Paco Coro"), "spend");
    assert.equal(classifyFiwindTipo("Cargo extra de RAPPI"), "spend");
  });

  it("skips near-zero yields and keeps meaningful ones", () => {
    assert.equal(isDustYield("yield", 0.68, null), true);
    assert.equal(isDustYield("yield", 0, 0.00005), true);
    assert.equal(isDustYield("yield", 0, 0), true);
    assert.equal(isDustYield("yield", 9.28, null), false);
    assert.equal(isDustYield("yield", 460, null), false);
    assert.equal(isDustYield("spend", 0.5, null), false);
  });

  it("does not treat Pago a X as a card payment", () => {
    assert.equal(isCardPaymentEntry("Pago a DIA"), false);
    assert.equal(isCardPaymentEntry("SU PAGO EN PESOS"), true);
  });

  it("marks conversions / crypto / yields as accounting, not gastos", () => {
    assert.equal(isBankAccountingEntry("Conversión"), true);
    assert.equal(isBankAccountingEntry("Compra KO"), true);
    assert.equal(isBankAccountingEntry("Venta KO"), true);
    assert.equal(isBankAccountingEntry("Ganancia diaria"), true);
    assert.equal(isBankAccountingEntry("Rendimiento bonificado"), true);
    assert.equal(isBankAccountingEntry("Depósito"), true);
    assert.equal(isBankAccountingEntry("Retiro"), true);
    assert.equal(isBankAccountingEntry("Pago a DIA"), false);
    assert.equal(isBankAccountingEntry("Retiro a Elena Paco Coro"), false);
    assert.equal(isFiwindNonExpenseTipo("Conversión"), true);
  });

  it("skips TRANSFERENCIA ARS and amount-only Tipo; keeps COMPRA SUPER / Pago a", () => {
    const transfers = [
      "TRANSFERENCIA ARS",
      "Transferencia ARS",
      "TRANSFERENCIA USDC",
      "TRANSFERENCIA USDT",
      "TRANSFERENCIA USD",
      "TRANSFERENCIA",
    ];
    for (const t of transfers) {
      assert.equal(classifyFiwindTipo(t), "transfer", t);
      assert.equal(isFiwindWalletTransferTipo(t), true, t);
      assert.equal(isFiwindNonExpenseTipo(t), true, t);
      assert.equal(isBankAccountingEntry(t), true, t);
      assert.equal(
        isExpenseRow({ isPayment: false, descriptionNormalized: t }),
        false,
        t,
      );
      assert.equal(reclassifyTargetForDescription(t), "conversiones", t);
    }
    assert.equal(
      isFiwindWalletTransferTipo("TRANSFERENCIA A Elena Paco Coro"),
      false,
    );
    assert.equal(
      classifyFiwindTipo("TRANSFERENCIA A Elena Paco Coro"),
      "spend",
    );

    const amounts = ["12800", "79.66", "34.7", "35.69", "2.47", "120000", " 79.66 "];
    for (const t of amounts) {
      assert.equal(isFiwindNumericTipo(t), true, t);
      assert.equal(classifyFiwindTipo(t), "numeric", t);
      assert.equal(isFiwindNonExpenseTipo(t), true, t);
      assert.equal(isBankAccountingEntry(t), true, t);
      assert.equal(
        isExpenseRow({ isPayment: false, descriptionNormalized: t.trim() }),
        false,
        t,
      );
      assert.equal(reclassifyTargetForDescription(t), "conversiones", t);
    }
    assert.equal(isFiwindNumericTipo("Pago a 0002"), false);
    assert.equal(classifyFiwindTipo("Pago a 0002"), "spend");

    const groceries = ["COMPRA SUPER ARS", "Compra Super ARS", "COMPRA SUPER"];
    for (const t of groceries) {
      assert.equal(classifyFiwindTipo(t), "spend", t);
      assert.equal(isFiwindNonExpenseTipo(t), false, t);
      assert.equal(isBankAccountingEntry(t), false, t);
      assert.equal(
        isExpenseRow({ isPayment: false, descriptionNormalized: t }),
        true,
        t,
      );
      assert.equal(matchCategory(t).slug, "supermercado", t);
    }

    assert.equal(classifyFiwindTipo("Pago a DIA"), "spend");
    assert.equal(classifyFiwindTipo("Pago a PAYU*AR*UBER"), "spend");
    assert.equal(
      isExpenseRow({
        isPayment: false,
        descriptionNormalized: "Pago a PAYU*AR*UBER",
      }),
      true,
    );
    assert.equal(classifyFiwindTipo("Compra KO"), "investment");
    assert.equal(classifyFiwindTipo("Compra USDC"), "investment");
    assert.equal(classifyFiwindTipo("Venta KO"), "investment");
    assert.equal(reclassifyTargetForDescription("Pago a DIA"), undefined);
    assert.equal(reclassifyTargetForDescription("Compra KO"), "crypto-inversiones");
  });

  it("pairs convert-then-pay so the conversion is not a second expense", () => {
    const rows = [
      {
        date: "2026-08-18",
        kind: "spend" as const,
        amountArs: 15600,
        amountUsd: null,
      },
      {
        date: "2026-08-18",
        kind: "conversion" as const,
        amountArs: 15600,
        amountUsd: null,
      },
    ];
    assert.equal(conversionPairedWithSpend(rows[1]!, rows), true);
    assert.equal(
      isExpenseRow({
        isPayment: flagsForFiwindKind("conversion").isPayment,
        isCredit: flagsForFiwindKind("conversion").isCredit,
        descriptionNormalized: "Conversión",
      }),
      false,
    );
    assert.equal(
      isExpenseRow({
        isPayment: false,
        descriptionNormalized: "Retiro a Felicitas Ocampo Jimenez",
      }),
      true,
    );
  });

  it("maps Tipo to category hints", () => {
    assert.equal(categoryHintForFiwindKind("conversion"), "conversiones");
    assert.equal(categoryHintForFiwindKind("investment"), "crypto-inversiones");
    assert.equal(categoryHintForFiwindKind("yield"), "rendimientos");
    assert.equal(categoryHintForFiwindKind("transfer"), "conversiones");
    assert.equal(categoryHintForFiwindKind("numeric"), "conversiones");
    assert.equal(categoryHintForFiwindKind("spend"), undefined);
  });

  it("extracts merchants so Pago a DIA / YPF / UBER categorize", () => {
    assert.equal(extractFiwindMerchant("Pago a DIA"), "DIA");
    assert.equal(extractFiwindMerchant("Cargo extra de RAPPI"), "RAPPI");
    assert.equal(exactFiwindMerchantSlug("Pago a DIA"), "supermercado");
    assert.equal(matchCategory("Pago a DIA").slug, "supermercado");
    assert.equal(matchCategory("Pago a DIA TIENDA 536").slug, "supermercado");
    assert.equal(matchCategory("Pago a PAYU*AR*UBER").slug, "transporte");
    assert.equal(matchCategory("Pago a YPF").slug, "transporte");
    assert.equal(matchCategory("Pago a Spotify").slug, "streaming");
    assert.equal(matchCategory("Retiro a Elena Paco Coro").slug, "envios");
    assert.equal(matchCategory("Conversión").slug, "conversiones");
    assert.equal(matchCategory("Compra KO").slug, "crypto-inversiones");
    assert.equal(matchCategory("Ganancia diaria").slug, "rendimientos");
    assert.equal(matchCategory("COMPRA SUPER ARS").slug, "supermercado");
    assert.equal(matchCategory("TRANSFERENCIA ARS").slug, "conversiones");
    assert.equal(matchCategory("12800").slug, "conversiones");
    assert.equal(matchCategory("79.66").slug, "conversiones");
  });
});

describe("own-account cuenta tuya", () => {
  it("classifies A/De una cuenta tuya as transfer (non-expense)", () => {
    assert.equal(classifyFiwindTipo("A una cuenta tuya"), "transfer");
    assert.equal(classifyFiwindTipo("De una cuenta tuya"), "transfer");
    assert.equal(isFiwindNonExpenseTipo("A una cuenta tuya"), true);
    assert.equal(isBankAccountingEntry("De una cuenta tuya"), true);
  });
});
