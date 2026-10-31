import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  internalTransferFingerprint,
  reclassifyIncomeTargetHouseholdId,
} from "@/lib/import/reclassify-fiwind";

describe("internalTransferFingerprint", () => {
  it("is stable for CR TBE 300k (Consumos upsert key)", () => {
    const a = internalTransferFingerprint({
      date: "2026-09-10",
      label: "CR TBE INM COE",
      amountArs: 300000,
      amountUsd: null,
    });
    const b = internalTransferFingerprint({
      date: "2026-09-10",
      label: "cr tbe inm coe",
      amountArs: 300000.0,
      amountUsd: null,
    });
    assert.equal(a, b);
    assert.equal(a.length, 32);
  });
});

describe("backfill Transferencia interna without income row", () => {
  it("fingerprint for CR TBE 300k is stable so Consumos upsert is searchable", () => {
    const fp = internalTransferFingerprint({
      date: "2026-09-10",
      label: "CR TBE INM COE",
      amountArs: 300000,
      amountUsd: null,
    });
    // Same amount typed as search "300000" / "300000.00"
    const fp2 = internalTransferFingerprint({
      date: "2026-09-10",
      label: "CR TBE INM COE",
      amountArs: 300000.0,
      amountUsd: undefined,
    });
    assert.equal(fp, fp2);
  });
});

describe("reclassifyIncomeTargetHouseholdId", () => {
  it("prefers Personal over active Casita for income→interna upsert", () => {
    assert.equal(
      reclassifyIncomeTargetHouseholdId("casita-id", "personal-id"),
      "personal-id",
    );
    assert.equal(
      reclassifyIncomeTargetHouseholdId("casita-id", null),
      "casita-id",
    );
  });
});
