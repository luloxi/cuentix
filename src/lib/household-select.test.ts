import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickActiveHouseholdId } from "./household-select";

describe("pickActiveHouseholdId", () => {
  const shared = {
    householdId: "hh-shared",
    joinedAt: new Date("2025-01-01"),
  };
  const work = {
    householdId: "hh-work",
    joinedAt: new Date("2026-09-01"),
  };

  it("defaults to the oldest hogar (Shared) so Work is not mixed in", () => {
    assert.equal(pickActiveHouseholdId([work, shared]), "hh-shared");
    assert.equal(pickActiveHouseholdId([]), null);
  });

  it("honors an explicit switch to Work", () => {
    assert.equal(
      pickActiveHouseholdId([shared, work], "hh-work"),
      "hh-work",
    );
  });

  it("ignores a stale preferred id that the user does not belong to", () => {
    assert.equal(
      pickActiveHouseholdId([shared, work], "hh-deleted"),
      "hh-shared",
    );
  });

  it("defaults to Personal when that hogar exists, even if Shared is older", () => {
    const personal = {
      householdId: "hh-personal",
      name: "Personal",
      joinedAt: new Date("2026-09-07"),
    };
    assert.equal(
      pickActiveHouseholdId(
        [{ ...shared, name: "Shared" }, personal, { ...work, name: "Work" }],
      ),
      "hh-personal",
    );
  });

  it("keeps the cookie when it points at Shared", () => {
    const personal = {
      householdId: "hh-personal",
      name: "Personal",
      joinedAt: new Date("2026-09-07"),
    };
    assert.equal(
      pickActiveHouseholdId(
        [{ ...shared, name: "Shared" }, personal],
        "hh-shared",
      ),
      "hh-shared",
    );
  });
});
