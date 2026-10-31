import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  displayPrefixForToken,
  generateHouseholdTokenPlaintext,
  hashHouseholdToken,
  householdIdForAuth,
  isolateRowsByHousehold,
  matchHouseholdTokenRecord,
  resolveBearerAgainstStore,
  HOUSEHOLD_TOKEN_PREFIX,
  type HouseholdTokenRecord,
} from "./household-token";

function record(
  plaintext: string,
  householdId: string,
  revokedAt: Date | null = null,
): HouseholdTokenRecord {
  return {
    id: `id-${householdId}`,
    tokenHash: hashHouseholdToken(plaintext),
    householdId,
    revokedAt,
  };
}

describe("household token crypto", () => {
  it("generates lc_h_ secrets and stores only a sha256 hex", () => {
    const a = generateHouseholdTokenPlaintext();
    const b = generateHouseholdTokenPlaintext();
    assert.ok(a.startsWith(HOUSEHOLD_TOKEN_PREFIX));
    assert.notEqual(a, b);
    const ha = hashHouseholdToken(a);
    assert.equal(ha.length, 64);
    assert.match(ha, /^[0-9a-f]{64}$/);
    assert.notEqual(ha, a);
    assert.equal(hashHouseholdToken(a), ha);
    assert.notEqual(hashHouseholdToken(b), ha);
    assert.equal(displayPrefixForToken(a), a.slice(0, 12));
    assert.ok(!ha.includes(a.slice(HOUSEHOLD_TOKEN_PREFIX.length)));
  });
});

describe("multi-tenant isolation: household A token cannot read B", () => {
  const tokenA = generateHouseholdTokenPlaintext();
  const tokenB = generateHouseholdTokenPlaintext();
  const store: HouseholdTokenRecord[] = [
    record(tokenA, "hh-a"),
    record(tokenB, "hh-b"),
  ];
  const rows = [
    { householdId: "hh-a", secret: "gasto-de-A" },
    { householdId: "hh-b", secret: "gasto-de-B" },
  ];

  it("resolves each token only to its own household_id", () => {
    const a = resolveBearerAgainstStore({ provided: tokenA, records: store });
    const b = resolveBearerAgainstStore({ provided: tokenB, records: store });
    assert.equal(a.kind, "household");
    assert.equal(b.kind, "household");
    if (a.kind !== "household" || b.kind !== "household") return;
    assert.equal(a.householdId, "hh-a");
    assert.equal(b.householdId, "hh-b");
    assert.notEqual(a.householdId, b.householdId);
  });

  it("query scope of A never includes B's rows", () => {
    const a = resolveBearerAgainstStore({ provided: tokenA, records: store });
    assert.equal(a.kind, "household");
    if (a.kind !== "household") return;
    const scoped = isolateRowsByHousehold(a.householdId, rows);
    assert.deepEqual(
      scoped.map((r) => r.secret),
      ["gasto-de-A"],
    );
    assert.ok(!scoped.some((r) => r.householdId === "hh-b"));
    assert.ok(!scoped.some((r) => r.secret === "gasto-de-B"));
  });

  it("query scope of B never includes A's rows", () => {
    const b = resolveBearerAgainstStore({ provided: tokenB, records: store });
    assert.equal(b.kind, "household");
    if (b.kind !== "household") return;
    const scoped = isolateRowsByHousehold(b.householdId, rows);
    assert.deepEqual(
      scoped.map((r) => r.secret),
      ["gasto-de-B"],
    );
    assert.ok(!scoped.some((r) => r.householdId === "hh-a"));
  });

  it("a wrong token sees nothing, even if the global admin secret is set", () => {
    const miss = resolveBearerAgainstStore({
      provided: generateHouseholdTokenPlaintext(),
      records: store,
      globalToken: "admin-global-secret",
    });
    assert.equal(miss.kind, "none");
  });

  it("hash of A never matches the stored hash of B", () => {
    assert.equal(
      matchHouseholdTokenRecord(hashHouseholdToken(tokenA), store)?.householdId,
      "hh-a",
    );
    assert.notEqual(
      matchHouseholdTokenRecord(hashHouseholdToken(tokenA), store)?.householdId,
      "hh-b",
    );
    assert.equal(
      matchHouseholdTokenRecord(hashHouseholdToken("not-a-token"), store),
      null,
    );
  });
});

describe("revoke / rotate / global fallback", () => {
  it("revoked household token does not authenticate and does not fall back to global", () => {
    const tokenA = generateHouseholdTokenPlaintext();
    const store: HouseholdTokenRecord[] = [
      record(tokenA, "hh-a", new Date("2026-09-01")),
    ];
    const resolved = resolveBearerAgainstStore({
      provided: tokenA,
      records: store,
      globalToken: tokenA,
    });
    assert.equal(resolved.kind, "none");
  });

  it("after rotate, old plaintext misses and new plaintext hits the same household", () => {
    const oldToken = generateHouseholdTokenPlaintext();
    const newToken = generateHouseholdTokenPlaintext();
    const store: HouseholdTokenRecord[] = [
      { ...record(oldToken, "hh-a"), id: "old", revokedAt: new Date() },
      { ...record(newToken, "hh-a"), id: "new", revokedAt: null },
    ];
    const oldAuth = resolveBearerAgainstStore({
      provided: oldToken,
      records: store,
    });
    const newAuth = resolveBearerAgainstStore({
      provided: newToken,
      records: store,
    });
    assert.equal(oldAuth.kind, "none");
    assert.equal(newAuth.kind, "household");
    if (newAuth.kind !== "household") return;
    assert.equal(newAuth.householdId, "hh-a");
  });

  it("global admin/dev token is used only when no household hash matches", () => {
    const tokenA = generateHouseholdTokenPlaintext();
    const store: HouseholdTokenRecord[] = [record(tokenA, "hh-a")];
    const householdWins = resolveBearerAgainstStore({
      provided: tokenA,
      records: store,
      globalToken: "admin-global-secret",
    });
    assert.equal(householdWins.kind, "household");
    if (householdWins.kind !== "household") return;
    assert.equal(householdWins.householdId, "hh-a");

    const global = resolveBearerAgainstStore({
      provided: "admin-global-secret",
      records: store,
      globalToken: "admin-global-secret",
    });
    assert.equal(global.kind, "global");
  });
});

describe("householdIdForAuth", () => {
  it("bound household token never falls back to the acting user's other household", () => {
    assert.equal(
      householdIdForAuth({
        kind: "household",
        tokenHouseholdId: "hh-a",
        userHouseholdId: "hh-b",
      }),
      "hh-a",
    );
    assert.notEqual(
      householdIdForAuth({
        kind: "household",
        tokenHouseholdId: "hh-a",
        userHouseholdId: "hh-b",
      }),
      "hh-b",
    );
  });

  it("session/global derive the user's household", () => {
    assert.equal(
      householdIdForAuth({
        kind: "session",
        tokenHouseholdId: "hh-a",
        userHouseholdId: "hh-b",
      }),
      "hh-b",
    );
    assert.equal(
      householdIdForAuth({
        kind: "global",
        userHouseholdId: "hh-admin",
      }),
      "hh-admin",
    );
  });
});
