import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  forceSharedOnlyForHousehold,
  isPersonalHouseholdName,
  pickPersonalHouseholdId,
  shouldListPersonalOwnedRows,
} from "./personal-household";

describe("pickPersonalHouseholdId", () => {
  it("prefers Personal over Mi espacio and Casita", () => {
    const id = pickPersonalHouseholdId([
      { id: "c", name: "Casita", joinedAt: "2026-01-01" },
      { id: "m", name: "Mi espacio", joinedAt: "2026-01-02" },
      { id: "p", name: "Personal", joinedAt: "2026-01-03" },
      { id: "i", name: "Invoice IOG", joinedAt: "2026-01-04" },
    ]);
    assert.equal(id, "p");
  });

  it("falls back to Mi espacio then oldest non-protected", () => {
    assert.equal(
      pickPersonalHouseholdId([
        { id: "c", name: "Casita", joinedAt: "2026-01-01" },
        { id: "m", name: "Mi espacio", joinedAt: "2026-02-01" },
      ]),
      "m",
    );
    assert.equal(
      pickPersonalHouseholdId([
        { id: "c", name: "Casita", joinedAt: "2026-01-01" },
        { id: "x", name: "Billetera", joinedAt: "2026-03-01" },
        { id: "y", name: "Otro", joinedAt: "2026-02-01" },
      ]),
      "y",
    );
  });

  it("returns null when only label hogares exist", () => {
    assert.equal(
      pickPersonalHouseholdId([
        { id: "c", name: "Casita", joinedAt: "2026-01-01" },
        { id: "i", name: "Invoice IOG", joinedAt: "2026-01-02" },
      ]),
      null,
    );
  });
});

describe("isPersonalHouseholdName", () => {
  it("matches Personal and Mi espacio", () => {
    assert.equal(isPersonalHouseholdName("Personal"), true);
    assert.equal(isPersonalHouseholdName("mi espacio"), true);
    assert.equal(isPersonalHouseholdName("Casita"), false);
  });
});

describe("shouldListPersonalOwnedRows / forceSharedOnlyForHousehold", () => {
  it("lists personal rows only on Personal space and Invoice IOG", () => {
    assert.equal(shouldListPersonalOwnedRows("Personal"), true);
    assert.equal(shouldListPersonalOwnedRows("Mi espacio"), true);
    assert.equal(shouldListPersonalOwnedRows("Invoice IOG"), true);
    assert.equal(shouldListPersonalOwnedRows("Casita"), false);
    assert.equal(shouldListPersonalOwnedRows("Otro hogar"), false);
  });

  it("forces sharedOnly on Casita / non-Personal assign hogares", () => {
    assert.equal(forceSharedOnlyForHousehold("Casita"), true);
    assert.equal(forceSharedOnlyForHousehold("Personal"), false);
    assert.equal(forceSharedOnlyForHousehold("Invoice IOG"), false);
  });
});
