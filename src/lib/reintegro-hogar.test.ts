process.env.NEXT_PUBLIC_REINTEGRO_PAYEES = "ANA+LOPEZ,ANITA";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countHogarReintegroMatches,
  looksLikeHogarReintegroPayee,
  looksLikeBareHogarReintegroPayee,
  isHogarReintegroDescription,
  isConsumosHiddenPayment,
  isReintegroHogarTipo,
  sameHogarReintegroKey,
} from "./reintegro-hogar";

describe("looksLikeHogarReintegroPayee", () => {
  it("matches Retiro/Pago a Ana Lopez…", () => {
    assert.equal(
      looksLikeHogarReintegroPayee(
        "Retiro a Ana Lopez Gomez Diaz",
      ),
      true,
    );
    assert.equal(
      looksLikeHogarReintegroPayee("PAGO A ANA LOPEZ"),
      true,
    );
    assert.equal(
      looksLikeHogarReintegroPayee("Transferencia a Anita"),
      true,
    );
  });

  it("ignores unrelated people and non-outbound lines", () => {
    assert.equal(
      looksLikeHogarReintegroPayee("Retiro a Elena Paco Coro"),
      false,
    );
    assert.equal(
      looksLikeHogarReintegroPayee("PAGO A DIA"),
      false,
    );
    assert.equal(
      looksLikeHogarReintegroPayee("Ana Lopez en el super"),
      false,
    );
    // First name alone is too weak (false positives).
    assert.equal(
      looksLikeHogarReintegroPayee("Retiro a Ana"),
      false,
    );
  });
});

describe("countHogarReintegroMatches", () => {
  it("counts same description and respects onlyUnset", () => {
    const rows = [
      {
        id: "1",
        descriptionNormalized: "Retiro a Ana Lopez Gomez Diaz",
        isPayment: false,
      },
      {
        id: "2",
        descriptionNormalized: "Retiro a Ana Lopez Gomez Diaz",
        isPayment: true,
      },
      {
        id: "3",
        descriptionNormalized: "Retiro a Elena Paco Coro",
        isPayment: false,
      },
    ];
    assert.equal(
      countHogarReintegroMatches(
        rows,
        "Retiro a Ana Lopez Gomez Diaz",
      ),
      2,
    );
    assert.equal(
      countHogarReintegroMatches(
        rows,
        "Retiro a Ana Lopez Gomez Diaz",
        { onlyUnset: true },
      ),
      1,
    );
    assert.equal(
      sameHogarReintegroKey(
        "Retiro a Ana Lopez Gomez Diaz",
        "retiro a ana lopez gomez diaz",
      ),
      true,
    );
  });
});

describe("looksLikeBareHogarReintegroPayee / isHogarReintegroDescription", () => {
  it("matches bare Fiwind CSV payee (Ana Lopez…)", () => {
    assert.equal(
      looksLikeBareHogarReintegroPayee(
        "Ana Lopez Gomez Diaz",
      ),
      true,
    );
    assert.equal(
      isHogarReintegroDescription("Ana Lopez Gomez Diaz"),
      true,
    );
    assert.equal(looksLikeBareHogarReintegroPayee("Anita"), true);
  });

  it("does not treat merchant lines as bare reintegro", () => {
    assert.equal(
      looksLikeBareHogarReintegroPayee("Ana Lopez en el super"),
      false,
    );
    assert.equal(
      isHogarReintegroDescription("Ana Lopez en el super"),
      false,
    );
  });
});

describe("Consumos visibility for hogar reintegro isPayment", () => {
  it("keeps Ana visible; hides unrelated payments", () => {
    assert.equal(
      isConsumosHiddenPayment(true, "Ana Lopez Gomez Diaz"),
      false,
    );
    assert.equal(
      isReintegroHogarTipo(true, "Ana Lopez Gomez Diaz"),
      true,
    );
    assert.equal(isConsumosHiddenPayment(true, "SU PAGO EN PESOS"), true);
    assert.equal(isConsumosHiddenPayment(false, "DIA"), false);
  });

  it("Rainman: Transferencia interna visible by description even without category", () => {
    assert.equal(
      isConsumosHiddenPayment(true, "CR TBE INM COE", null),
      false,
    );
    assert.equal(
      isConsumosHiddenPayment(true, "CR TRF INM COE", undefined),
      false,
    );
    assert.equal(
      isConsumosHiddenPayment(true, "A una cuenta tuya", null),
      false,
    );
    assert.equal(
      isConsumosHiddenPayment(true, "BBVA CA$ TRANSFERENCIA", null),
      false,
    );
    // Still hidden when category is plain pagos
    assert.equal(
      isConsumosHiddenPayment(true, "SU PAGO EN PESOS", "pagos"),
      true,
    );
  });
});
