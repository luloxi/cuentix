import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickActiveHouseholdId } from "./household-select";

describe("pickActiveHouseholdId", () => {
  const casita = {
    householdId: "hh-casita",
    joinedAt: new Date("2025-01-01"),
  };
  const iog = {
    householdId: "hh-invoice-iog",
    joinedAt: new Date("2026-09-01"),
  };

  it("defaults to the oldest hogar (Casita) so Invoice IOG is not mixed in", () => {
    assert.equal(pickActiveHouseholdId([iog, casita]), "hh-casita");
    assert.equal(pickActiveHouseholdId([]), null);
  });

  it("honors an explicit switch to Invoice IOG", () => {
    assert.equal(
      pickActiveHouseholdId([casita, iog], "hh-invoice-iog"),
      "hh-invoice-iog",
    );
  });

  it("ignores a stale preferred id that the user does not belong to", () => {
    assert.equal(
      pickActiveHouseholdId([casita, iog], "hh-deleted"),
      "hh-casita",
    );
  });
});
