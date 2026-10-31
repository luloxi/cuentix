import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countHogarReintegroMatches,
  looksLikeHogarReintegroPayee,
  looksLikeBareHogarReintegroPayee,
  isHogarReintegroDescription,
  isConsumosHiddenPayment,
  isReintegroHogarTipo,
  parseReintegroPayees,
  sameHogarReintegroKey,
} from "./reintegro-hogar";

const GROUPS = parseReintegroPayees("ANA+LOPEZ,ANITA");

describe("looksLikeHogarReintegroPayee", () => {
  it("matches Retiro/Pago a Ana Lopez…", () => {
    assert.equal(
      looksLikeHogarReintegroPayee(
        "Retiro a Ana Lopez Gomez Diaz",
        GROUPS,
      ),
      true,
    );
    assert.equal(
      looksLikeHogarReintegroPayee("PAGO A ANA LOPEZ", GROUPS),
      true,
    );
    assert.equal(
      looksLikeHogarReintegroPayee("Transferencia a Anita", GROUPS),
      true,
    );
  });

  it("ignores unrelated people and non-outbound lines", () => {
    assert.equal(
      looksLikeHogarReintegroPayee("Retiro a Elena Paco Coro", GROUPS),
      false,
    );
    assert.equal(
      looksLikeHogarReintegroPayee("PAGO A DIA", GROUPS),
      false,
    );
    assert.equal(
      looksLikeHogarReintegroPayee("Ana Lopez en el super", GROUPS),
      false,
    );
    // First name alone is too weak (false positives).
    assert.equal(
      looksLikeHogarReintegroPayee("Retiro a Ana", GROUPS),
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
        GROUPS,
      ),
      2,
    );
    assert.equal(
      countHogarReintegroMatches(
        rows,
        "Retiro a Ana Lopez Gomez Diaz",
        GROUPS,
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
        GROUPS,
      ),
      true,
    );
    assert.equal(
      isHogarReintegroDescription("Ana Lopez Gomez Diaz", GROUPS),
      true,
    );
    assert.equal(looksLikeBareHogarReintegroPayee("Anita", GROUPS), true);
  });

  it("does not treat merchant lines as bare reintegro", () => {
    assert.equal(
      looksLikeBareHogarReintegroPayee("Ana Lopez en el super", GROUPS),
      false,
    );
    assert.equal(
      isHogarReintegroDescription("Ana Lopez en el super", GROUPS),
      false,
    );
  });
});

describe("Consumos visibility for hogar reintegro isPayment", () => {
  it("keeps Ana visible; hides unrelated payments", () => {
    const hogar = isHogarReintegroDescription("Ana Lopez Gomez Diaz", GROUPS);
    assert.equal(
      isConsumosHiddenPayment(true, "Ana Lopez Gomez Diaz", undefined, hogar),
      false,
    );
    assert.equal(
      isReintegroHogarTipo(true, hogar),
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
