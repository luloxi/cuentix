import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAmountUpdates } from "./transaction-amounts";

describe("resolveAmountUpdates (Cubierto must not wipe montos)", () => {
  it("omits amounts when undefined — Cubierto/Reintegro PATCH shape", () => {
    const out = resolveAmountUpdates({
      amountArs: undefined,
      amountUsd: undefined,
    });
    assert.equal("amountArs" in out, false);
    assert.equal("amountUsd" in out, false);
  });

  it("still clears when client sends null explicitly", () => {
    const out = resolveAmountUpdates({ amountArs: null, amountUsd: null });
    assert.equal(out.amountArs, null);
    assert.equal(out.amountUsd, null);
  });

  it("stores abs numeric strings for real edits", () => {
    const out = resolveAmountUpdates({ amountArs: -45000, amountUsd: 12.5 });
    assert.equal(out.amountArs, "45000");
    assert.equal(out.amountUsd, "12.5");
  });
});
