import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FIWIND_VARIANT_CAP,
  counterpartyKey,
  similarDescriptionVariants,
} from "@/lib/fiwind-similar";

const DIA_FORMS = [
  "Pago a DIA",
  "Cargo extra de DIA",
  "Devolución de DIA",
  "Devolucion de DIA",
  "Retiro a DIA",
];

function assertDisjoint(left: string, right: string) {
  const variants = new Set(similarDescriptionVariants(left));
  for (const variant of similarDescriptionVariants(right)) {
    assert.equal(variants.has(variant), false, `${left} overlaps ${right} on ${variant}`);
  }
  assert.notEqual(counterpartyKey(left), counterpartyKey(right));
}

describe("fiwind similar counterparty", () => {
  it("folds accents and case onto one key", () => {
    assert.equal(counterpartyKey("Pago a Día"), "DIA");
    assert.equal(counterpartyKey("Devolución de día"), "DIA");
    assert.equal(counterpartyKey("pago a dia"), "DIA");
    assert.equal(counterpartyKey("PAGO A DIA"), "DIA");
    assert.equal(counterpartyKey("  Pago a   DIA  "), "DIA");
    assert.equal(counterpartyKey("pago a dia"), counterpartyKey("PAGO A DIA"));
    assert.equal(counterpartyKey("Retiro a Elena Paco Coro"), "ELENA PACO CORO");
    assert.equal(counterpartyKey(""), "");
  });

  it("treats Pago a, Cargo extra, Devolución and Retiro a as one merchant", () => {
    const key = counterpartyKey("Pago a DIA");
    for (const form of DIA_FORMS) assert.equal(counterpartyKey(form), key, form);
    assert.equal(counterpartyKey("Devolución de DIA"), counterpartyKey("Devolucion de DIA"));
    const pago = similarDescriptionVariants("Pago a DIA");
    const cargo = similarDescriptionVariants("Cargo extra de DIA");
    assert.ok(pago.includes("Cargo extra de DIA"));
    assert.ok(pago.includes("Devolución de DIA"));
    assert.ok(pago.includes("Devolucion de DIA"));
    assert.ok(pago.includes("Retiro a DIA"));
    assert.ok(cargo.includes("Pago a DIA"));
    assert.ok(similarDescriptionVariants("pago a dia").includes("Pago a DIA"));
    assert.ok(similarDescriptionVariants("PAGO A DIA").includes("Pago a DIA"));
  });

  it("keeps accented storage and the folded merchant inside the cap", () => {
    const variants = similarDescriptionVariants("Pago a Día");
    assert.ok(variants.includes("Pago a Día"));
    assert.ok(variants.includes("Pago a DIA"));
    assert.ok(
      variants.includes("Cargo extra de Día") || variants.includes("Cargo extra de DIA"),
    );
    for (const variant of variants) assert.equal(counterpartyKey(variant), "DIA", variant);
  });

  it("does not treat DIA as DIAGEO, DIA TIENDA or DIARIA", () => {
    assertDisjoint("Pago a DIA", "Pago a DIAGEO");
    assertDisjoint("Pago a DIA", "Pago a DIA TIENDA");
    assertDisjoint("Pago a DIA", "Pago a DIARIA");
    assertDisjoint("Cargo extra de DIA", "Devolución de DIAGEO");
    assertDisjoint("Retiro a DIA", "Retiro a DIA TIENDA");
    for (const variant of similarDescriptionVariants("Pago a DIA")) {
      assert.equal(variant.includes("DIAGEO"), false, variant);
      assert.equal(variant.includes("TIENDA"), false, variant);
      assert.equal(variant.includes("DIARIA"), false, variant);
      assert.equal(counterpartyKey(variant), "DIA", variant);
    }
    for (const variant of similarDescriptionVariants("Pago a DIA TIENDA")) {
      assert.equal(counterpartyKey(variant), "DIA TIENDA", variant);
    }
  });

  it("returns at most 8 unique description_normalized strings", () => {
    assert.equal(FIWIND_VARIANT_CAP, 8);
    const samples = [
      "Pago a DIA",
      "pago a dia",
      "PAGO A DIA",
      "Pago a Día",
      "Devolución de RAPPI",
      "Retiro a Elena Paco Coro",
      "Cargo extra de DIA",
      "DIA",
      "DIAGEO",
      "",
      "   ",
      "Pago a Cargo extra de DIA",
    ];
    for (const sample of samples) {
      const variants = similarDescriptionVariants(sample);
      assert.ok(variants.length <= FIWIND_VARIANT_CAP, sample);
      assert.equal(new Set(variants).size, variants.length, sample);
    }
    assert.deepEqual(similarDescriptionVariants(""), []);
    assert.deepEqual(similarDescriptionVariants("   "), []);
  });
});
