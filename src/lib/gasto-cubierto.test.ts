import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countGastoCubiertoMatches,
  isGastoCubiertoTipo,
  isHogarUtilityCategory,
  isHogarUtilitySlug,
  sameGastoCubiertoKey,
} from "./gasto-cubierto";
import {
  isConsumosHiddenPayment,
  isHogarReintegroDescription,
  isReintegroHogarTipo,
  parseReintegroPayees,
} from "./reintegro-hogar";

const GROUPS = parseReintegroPayees("ANA+LOPEZ,ANITA");

describe("isHogarUtilitySlug / category", () => {
  it("matches system utility slugs", () => {
    for (const slug of [
      "alquiler",
      "luz",
      "agua",
      "gas",
      "internet",
      "expensas",
    ]) {
      assert.equal(isHogarUtilitySlug(slug), true);
    }
    assert.equal(isHogarUtilitySlug("supermercado"), false);
  });

  it("matches name aliases (expensas, electricidad)", () => {
    assert.equal(
      isHogarUtilityCategory({ slug: "custom", name: "Expensas edificio" }),
      true,
    );
    assert.equal(
      isHogarUtilityCategory({ slug: "custom", name: "Luz / Electricidad" }),
      true,
    );
    assert.equal(
      isHogarUtilityCategory({ slug: "supermercado", name: "Supermercado" }),
      false,
    );
  });
});

describe("isGastoCubiertoTipo + Consumos visibility", () => {
  it("utility isPayment stays visible as Cubierto; card payments hide", () => {
    assert.equal(
      isGastoCubiertoTipo(true, { slug: "luz", name: "Luz" }),
      true,
    );
    assert.equal(
      isConsumosHiddenPayment(true, "EDESUR FACTURA", "luz"),
      false,
    );
    assert.equal(
      isConsumosHiddenPayment(true, "SU PAGO EN PESOS", "pagos"),
      true,
    );
    assert.equal(isConsumosHiddenPayment(false, "EDESUR", "luz"), false);
  });

  it("does not steal Reintegro hogar Tipo", () => {
    const hogar = isHogarReintegroDescription("Ana Lopez Gomez Diaz", GROUPS);
    assert.equal(isReintegroHogarTipo(true, hogar), true);
    assert.equal(
      isConsumosHiddenPayment(
        true,
        "Ana Lopez Gomez Diaz",
        "envios",
        hogar,
      ),
      false,
    );
  });
});

describe("countGastoCubiertoMatches", () => {
  it("counts same merchant utility rows and respects onlyUnset", () => {
    const rows = [
      {
        id: "1",
        descriptionNormalized: "EDESUR",
        isPayment: false,
        categorySlug: "luz",
      },
      {
        id: "2",
        descriptionNormalized: "EDESUR",
        isPayment: true,
        categorySlug: "luz",
      },
      {
        id: "3",
        descriptionNormalized: "EDESUR",
        isPayment: false,
        categorySlug: "supermercado",
      },
      {
        id: "4",
        descriptionNormalized: "AYSA",
        isPayment: false,
        categorySlug: "agua",
      },
    ];
    assert.equal(countGastoCubiertoMatches(rows, "EDESUR"), 2);
    assert.equal(
      countGastoCubiertoMatches(rows, "EDESUR", { onlyUnset: true }),
      1,
    );
    assert.equal(sameGastoCubiertoKey("EDESUR", "edesur"), true);
  });
});
