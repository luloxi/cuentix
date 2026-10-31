import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractCardLast4FromTotal,
  filterToPrimaryCard,
  pickPrimaryCardLast4,
} from "./card-account";

describe("card last4", () => {
  it("reads Total Tarjeta Nro ****8958", () => {
    assert.equal(
      extractCardLast4FromTotal("Total Tarjeta Nro ****8958"),
      "8958",
    );
    assert.equal(extractCardLast4FromTotal("Total Tarjeta Nro ****7022"), "7022");
  });

  it("keeps untagged ultimos rows when filtering", () => {
    const rows = [
      { descriptionNormalized: "MERPAGO*TEMBICI", cardLast4: null },
      { descriptionNormalized: "DIA TIENDA", cardLast4: "7022" },
      { descriptionNormalized: "GROK XAI", cardLast4: "8958" },
    ];
    const primary = pickPrimaryCardLast4(rows);
    assert.equal(primary, "8958");
    const mine = filterToPrimaryCard(rows, primary);
    assert.equal(mine.length, 2);
    assert.equal(
      mine.some((r) => r.descriptionNormalized === "DIA TIENDA"),
      false,
    );
    assert.equal(
      mine.some((r) => r.descriptionNormalized === "MERPAGO*TEMBICI"),
      true,
    );
  });

  it("keeps untagged snapshot rows even when preferred last4 is set", () => {
    const rows = [
      { descriptionNormalized: "MERPAGO*ECOBICI", cardLast4: null },
      { descriptionNormalized: "DIA TIENDA", cardLast4: "7022" },
    ];
    const mine = filterToPrimaryCard(rows, "8958");
    assert.equal(
      mine.some((r) => r.descriptionNormalized === "MERPAGO*ECOBICI"),
      true,
    );
    assert.equal(
      mine.some((r) => r.descriptionNormalized === "DIA TIENDA"),
      false,
    );
  });
});
