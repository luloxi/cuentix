import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  amountSearchDigitStrings,
  digitsOnly,
  periodFilterAppliesForSearch,
  queryMatchesBbvaInternalTransferTokens,
  transactionMatchesQuery,
} from "./transactions";

describe("transactionMatchesQuery (Consumos search)", () => {
  const crTbe = {
    descriptionNormalized: "CR TBE INM COE",
    amountArs: 300000,
    amountUsd: null as number | null,
  };

  it("q=300000 matches row with amountArs=300000 and desc without digits", () => {
    assert.equal(transactionMatchesQuery(crTbe, "300000"), true);
  });

  it("q=CR TBE still matches description", () => {
    assert.equal(transactionMatchesQuery(crTbe, "CR TBE"), true);
    assert.equal(transactionMatchesQuery(crTbe, "cr tbe"), true);
  });

  it("q=300.000 (ARS formatted) matches via digit normalize", () => {
    assert.equal(transactionMatchesQuery(crTbe, "300.000"), true);
    assert.equal(transactionMatchesQuery(crTbe, "300.000,00"), true);
  });

  it("does not match unrelated amount", () => {
    assert.equal(
      transactionMatchesQuery(
        { descriptionNormalized: "SUPER", amountArs: 1500, amountUsd: null },
        "300000",
      ),
      false,
    );
  });

  it("matches amountUsd the same way", () => {
    assert.equal(
      transactionMatchesQuery(
        {
          descriptionNormalized: "FX SELF",
          amountArs: null,
          amountUsd: 1200.5,
        },
        "1200",
      ),
      true,
    );
  });

  it("digitsOnly strips separators", () => {
    assert.equal(digitsOnly("300.000,00"), "30000000");
    assert.equal(digitsOnly("$ 300000"), "300000");
  });

  it("amountSearchDigitStrings includes absolute integer digits", () => {
    const hay = amountSearchDigitStrings(300000);
    assert.ok(hay.some((h) => h.includes("300000")));
  });
});

describe("transactionMatchesQuery BBVA token → Transferencia interna", () => {
  it("q=CR TBE matches slug transferencia-interna without CR TBE letters in desc", () => {
    assert.equal(
      transactionMatchesQuery(
        {
          descriptionNormalized: "De una cuenta tuya",
          amountArs: 300000,
          amountUsd: null,
          categorySlug: "transferencia-interna",
        },
        "CR TBE",
      ),
      true,
    );
    assert.equal(
      transactionMatchesQuery(
        {
          descriptionNormalized: "Transferencia inmediata",
          amountArs: 300000,
          amountUsd: null,
          categorySlug: "transferencia-interna",
        },
        "cr tbe",
      ),
      true,
    );
  });

  it("q=CR TBE matches via isInternalTransferDescription when slug missing", () => {
    assert.equal(
      transactionMatchesQuery(
        {
          descriptionNormalized: "Transferencia inmediata",
          amountArs: 300000,
          amountUsd: null,
          categorySlug: null,
        },
        "CR TBE",
      ),
      true,
    );
  });

  it("q=300000 still matches amount on interna rows", () => {
    assert.equal(
      transactionMatchesQuery(
        {
          descriptionNormalized: "De una cuenta tuya",
          amountArs: 300000,
          amountUsd: null,
          categorySlug: "transferencia-interna",
        },
        "300000",
      ),
      true,
    );
  });

  it("q=pizza does not match all internas", () => {
    assert.equal(
      transactionMatchesQuery(
        {
          descriptionNormalized: "De una cuenta tuya",
          amountArs: 300000,
          amountUsd: null,
          categorySlug: "transferencia-interna",
        },
        "pizza",
      ),
      false,
    );
  });

  it("queryMatchesBbvaInternalTransferTokens detects CR TBE / TRF / INM COE", () => {
    assert.equal(queryMatchesBbvaInternalTransferTokens("CR TBE"), true);
    assert.equal(queryMatchesBbvaInternalTransferTokens("cr trf"), true);
    assert.equal(queryMatchesBbvaInternalTransferTokens("INM COE"), true);
    assert.equal(queryMatchesBbvaInternalTransferTokens("pizza"), false);
    assert.equal(queryMatchesBbvaInternalTransferTokens("300000"), false);
  });
});

describe("periodFilterAppliesForSearch (q ignores period)", () => {
  it("q match ignores period", () => {
    assert.equal(
      periodFilterAppliesForSearch({ period: "2026-09", q: "300000" }),
      false,
    );
    assert.equal(
      periodFilterAppliesForSearch({ period: "2026-09", q: "CR TBE" }),
      false,
    );
    assert.equal(
      periodFilterAppliesForSearch({ period: "2026-09", q: "  " }),
      true,
    );
    assert.equal(
      periodFilterAppliesForSearch({ period: "2026-09", q: "" }),
      true,
    );
    assert.equal(periodFilterAppliesForSearch({ period: "2026-09" }), true);
    assert.equal(periodFilterAppliesForSearch({ q: "300000" }), false);
  });
});
