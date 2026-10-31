import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countMatchingMerchant,
  learningPatternsFromDescription,
  normalizeMerchantText,
  sameMerchantKey,
} from "./learn";

describe("normalizeMerchantText", () => {
  it("uppercases, strips accents, collapses whitespace", () => {
    assert.equal(normalizeMerchantText("  café  Día  "), "CAFE DIA");
    assert.equal(normalizeMerchantText("SPOTIFY*PREMIUM"), "SPOTIFY*PREMIUM");
  });
});

describe("sameMerchantKey / countMatchingMerchant", () => {
  const rows = [
    { id: "a", descriptionNormalized: "SPOTIFY PREMIUM" },
    { id: "b", descriptionNormalized: "spotify premium" },
    { id: "c", descriptionNormalized: "SPOTIFY PREMIUM" },
    { id: "d", descriptionNormalized: "NETFLIX" },
  ];

  it("matches case-insensitively on the account key", () => {
    assert.equal(sameMerchantKey("spotify premium", "SPOTIFY PREMIUM"), true);
    assert.equal(sameMerchantKey("SPOTIFY", "NETFLIX"), false);
  });

  it("counts all matching including current (N for the toast)", () => {
    assert.equal(countMatchingMerchant(rows, "Spotify Premium"), 3);
  });

  it("can exclude the edited tx when counting others", () => {
    assert.equal(countMatchingMerchant(rows, "Spotify Premium", "a"), 2);
  });
});

describe("learningPatternsFromDescription", () => {
  it("keeps full key and strips cuota noise", () => {
    const patterns = learningPatternsFromDescription(
      "MERPAGO*FALABELLA CUOTA 2 / 3",
    );
    assert.ok(patterns[0]?.includes("MERPAGO*FALABELLA"));
    assert.ok(patterns.some((p) => p.startsWith("MERPAGO*")));
    assert.ok(
      patterns.some(
        (p) => p.includes("MERPAGO*FALABELLA") && !/CUOTA/.test(p),
      ),
    );
  });

  it("returns empty for blank input", () => {
    assert.deepEqual(learningPatternsFromDescription("   "), []);
  });
});
