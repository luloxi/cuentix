import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOUSEHOLD_NAME_EMPTY,
  HOUSEHOLD_NAME_MAX,
  HOUSEHOLD_NAME_RESERVED,
  HOUSEHOLD_NAME_TOO_LONG,
  normalizeHouseholdName,
  validateHouseholdName,
} from "./household-name";

describe("normalizeHouseholdName", () => {
  it("trims, collapses whitespace, and strips control characters", () => {
    assert.equal(normalizeHouseholdName("  Casa   Norte \n"), "Casa Norte");
    assert.equal(normalizeHouseholdName("Casa\u0001Norte"), "CasaNorte");
    assert.equal(normalizeHouseholdName("Casa\tNorte"), "Casa Norte");
    assert.equal(normalizeHouseholdName("  \u00A0 "), "");
  });
});

describe("validateHouseholdName", () => {
  it("accepts a normalized name of 1 to 60 characters", () => {
    assert.deepEqual(validateHouseholdName(" Oficina "), { ok: true, name: "Oficina" });
    const max = "a".repeat(HOUSEHOLD_NAME_MAX);
    assert.deepEqual(validateHouseholdName(max), { ok: true, name: max });
  });

  it("rejects empty, non-strings, and names over 60", () => {
    assert.deepEqual(validateHouseholdName(""), { ok: false, error: HOUSEHOLD_NAME_EMPTY });
    assert.deepEqual(validateHouseholdName("   "), { ok: false, error: HOUSEHOLD_NAME_EMPTY });
    assert.deepEqual(validateHouseholdName(12), { ok: false, error: HOUSEHOLD_NAME_EMPTY });
    assert.deepEqual(validateHouseholdName(null), { ok: false, error: HOUSEHOLD_NAME_EMPTY });
    const long = "b".repeat(HOUSEHOLD_NAME_MAX + 1);
    assert.deepEqual(validateHouseholdName(long), { ok: false, error: HOUSEHOLD_NAME_TOO_LONG });
    assert.deepEqual(validateHouseholdName("x".repeat(500)), {
      ok: false,
      error: HOUSEHOLD_NAME_TOO_LONG,
    });
  });

  it("rejects reserved names without caring about case or inner space", () => {
    for (const name of ["Personal", " mi espacio ", "INVOICE   IOG", "Casita", "CASITA"]) {
      assert.deepEqual(validateHouseholdName(name), {
        ok: false,
        error: HOUSEHOLD_NAME_RESERVED,
      });
    }
    assert.equal(validateHouseholdName("Mi oficina").ok, true);
  });

  it("allows personal names only when allowPersonal is set", () => {
    assert.deepEqual(validateHouseholdName("Mi espacio", { allowPersonal: true }), {
      ok: true,
      name: "Mi espacio",
    });
    assert.deepEqual(validateHouseholdName(" personal ", { allowPersonal: true }), {
      ok: true,
      name: "personal",
    });
    assert.deepEqual(validateHouseholdName("Mi espacio"), {
      ok: false,
      error: HOUSEHOLD_NAME_RESERVED,
    });
    assert.deepEqual(validateHouseholdName("Personal", { allowPersonal: false }), {
      ok: false,
      error: HOUSEHOLD_NAME_RESERVED,
    });
    assert.deepEqual(validateHouseholdName("casita", { allowPersonal: true }), {
      ok: false,
      error: HOUSEHOLD_NAME_RESERVED,
    });
    assert.deepEqual(validateHouseholdName("INVOICE   IOG", { allowPersonal: true }), {
      ok: false,
      error: HOUSEHOLD_NAME_RESERVED,
    });
  });
});
