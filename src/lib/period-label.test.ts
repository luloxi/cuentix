import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isYearMonth,
  periodSelectOptions,
  recentPeriods,
  selectedPeriod,
} from "./period-label";

describe("selectedPeriod", () => {
  it("honors a YYYY-MM query and ignores junk", () => {
    assert.equal(selectedPeriod("2026-07", "2026-11"), "2026-07");
    assert.equal(selectedPeriod("2026-13", "2026-11"), "2026-11");
    assert.equal(selectedPeriod("all", "2026-11"), "2026-11");
    assert.equal(selectedPeriod(null, "2026-11"), "2026-11");
    assert.equal(selectedPeriod("", "2026-11"), "2026-11");
  });

  it("lists recent months newest first and keeps the selection", () => {
    assert.equal(isYearMonth("2026-01"), true);
    assert.equal(isYearMonth("2026-00"), false);
    assert.deepEqual(recentPeriods("2026-03", 3), ["2026-03", "2026-02", "2026-01"]);
    assert.deepEqual(periodSelectOptions("2024-12", "2026-02", 2), [
      "2026-02",
      "2026-01",
      "2024-12",
    ]);
  });
});
