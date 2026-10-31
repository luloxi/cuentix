import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyTransferRows,
  deriveOwnAccountIds,
  extractAccountIds,
  parseOwnAccountIds,
  transferDirection,
  type TransferClassRow,
} from "./transfer-class";

const CUIT = "1".repeat(11);
const CVU = "2".repeat(22);
const OTHER_CUIT = "3".repeat(11);
const OTHER_CVU = "4".repeat(22);
const SIXTY_K =
  "outgoing transfer (payee unknown) | transferencia inmediata | 100 - banca online | payee not in export";

function row(partial: Partial<TransferClassRow> & Pick<TransferClassRow, "id">): TransferClassRow {
  return {
    householdId: "h1",
    date: "2026-08-10",
    bank: "BBVA",
    description: "TRANSFERENCIA",
    amountArs: "100",
    amountUsd: null,
    isPayment: 0,
    isCredit: 0,
    ...partial,
  };
}

function classify(rows: TransferClassRow[], ownIds: ReadonlySet<string>, homes: ReadonlySet<string>) {
  return classifyTransferRows(rows, ownIds, homes);
}

describe("extractAccountIds", () => {
  it("reads a dashed CUIT and a 22-digit CVU without splitting the CVU into a CUIT", () => {
    const dashed = `11-${"1".repeat(8)}-1`;
    assert.equal(dashed.replace(/\D/g, ""), CUIT);
    assert.deepEqual(extractAccountIds(`TRANSFERENCIA ${dashed}`), [CUIT]);
    assert.deepEqual(extractAccountIds(`CVU ${CVU}`), [CVU]);
    assert.deepEqual(extractAccountIds("100 - banca online"), []);
  });
});

describe("classifyTransferRows", () => {
  const homes = new Set(["h1", "h2"]);

  it("is internal when the description carries a configured own id", () => {
    const own = parseOwnAccountIds(CUIT);
    const result = classify(
      [row({ id: "own", description: `TRANSFERENCIA 11-${"1".repeat(8)}-1`, amountArs: "5000" })],
      own,
      homes,
    );
    assert.equal(result.internalIds.has("own"), true);
    assert.equal(result.revisarIds.has("own"), false);
    assert.equal(result.thirdPartyIds.has("own"), false);
  });

  it("is internal when the own id is derived from a marked row", () => {
    const rows = [
      row({
        id: "mark",
        description: `CUENTA PROPIA ${CUIT}`,
        amountArs: "1",
      }),
      row({
        id: "move",
        description: `TRANSFERENCIA INMEDIATA ${CUIT}`,
        amountArs: "5000",
      }),
    ];
    const own = deriveOwnAccountIds(rows, new Set());
    assert.equal(own.has(CUIT), true);
    const result = classify(rows, own, homes);
    assert.equal(result.internalIds.has("move"), true);
    assert.equal(result.internalIds.has("mark"), false);
  });

  it("is internal when an incoming twin is within 1 day in another bank", () => {
    const result = classify(
      [
        row({ id: "out", date: "2026-08-10", bank: "BBVA", amountArs: "100" }),
        row({
          id: "inn",
          date: "2026-08-11",
          bank: "GALICIA",
          description: "TRANSFERENCIA",
          amountArs: "100",
          isCredit: 1,
        }),
      ],
      new Set(),
      homes,
    );
    assert.equal(result.internalIds.has("out"), true);
    assert.equal(result.revisarIds.has("out"), false);
  });

  it("is internal when the twin is in another household of the same user", () => {
    const result = classify(
      [
        row({ id: "out", householdId: "h1", bank: "BBVA", amountArs: "100" }),
        row({
          id: "inn",
          householdId: "h2",
          bank: "BBVA",
          description: "TRANSFERENCIA",
          amountArs: "100",
          isCredit: 1,
        }),
      ],
      new Set(),
      homes,
    );
    assert.equal(result.internalIds.has("out"), true);
  });

  it("is not internal when the twin household belongs to another user", () => {
    const result = classify(
      [
        row({ id: "out", householdId: "h1", amountArs: "100" }),
        row({
          id: "foreign",
          householdId: "h-foreign",
          bank: "GALICIA",
          description: "TRANSFERENCIA",
          amountArs: "100",
          isCredit: 1,
        }),
      ],
      new Set(),
      new Set(["h1"]),
    );
    assert.equal(result.internalIds.has("out"), false);
    assert.equal(result.revisarIds.has("out"), true);
  });

  it("is not internal when the twin is 2 days apart", () => {
    const result = classify(
      [
        row({ id: "out", date: "2026-08-10", amountArs: "100" }),
        row({
          id: "late",
          date: "2026-08-12",
          bank: "GALICIA",
          description: "TRANSFERENCIA",
          amountArs: "100",
          isCredit: 1,
        }),
      ],
      new Set(),
      homes,
    );
    assert.equal(result.internalIds.has("out"), false);
    assert.equal(result.revisarIds.has("out"), true);
  });

  it("is not internal for same-direction 100 vs 100", () => {
    const result = classify(
      [
        row({ id: "a", bank: "BBVA", amountArs: "100", isCredit: 0 }),
        row({ id: "b", bank: "GALICIA", description: "TRANSFERENCIA", amountArs: "100", isCredit: 0 }),
      ],
      new Set(),
      homes,
    );
    assert.equal(result.internalIds.size, 0);
    assert.equal(result.revisarIds.has("a"), true);
    assert.equal(result.revisarIds.has("b"), true);
  });

  it("is not internal for 100 vs -100 when the signs disagree", () => {
    const result = classify(
      [
        row({ id: "out", bank: "BBVA", amountArs: "100", isCredit: 0 }),
        row({
          id: "flip",
          bank: "GALICIA",
          description: "AJUSTE",
          amountArs: "-100",
          isCredit: 0,
        }),
      ],
      new Set(),
      homes,
    );
    assert.equal(result.internalIds.has("out"), false);
    assert.equal(result.revisarIds.has("out"), true);
  });

  it("pairs 1:1, closest day first then id", () => {
    const result = classify(
      [
        row({ id: "far", date: "2026-08-01", bank: "BBVA", amountArs: "100" }),
        row({ id: "near", date: "2026-08-02", bank: "GALICIA", amountArs: "100" }),
        row({
          id: "inn",
          date: "2026-08-02",
          bank: "MACRO",
          description: "TRANSFERENCIA",
          amountArs: "100",
          isCredit: 1,
        }),
      ],
      new Set(),
      homes,
    );
    assert.equal(result.internalIds.has("near"), true);
    assert.equal(result.internalIds.has("far"), false);
    assert.equal(result.revisarIds.has("far"), true);

    const tie = classify(
      [
        row({ id: "b", date: "2026-08-02", bank: "BBVA", amountArs: "100" }),
        row({ id: "a", date: "2026-08-02", bank: "GALICIA", amountArs: "100" }),
        row({
          id: "inn",
          date: "2026-08-02",
          bank: "MACRO",
          description: "TRANSFERENCIA",
          amountArs: "100",
          isCredit: 1,
        }),
      ],
      new Set(),
      homes,
    );
    assert.deepEqual([...tie.internalIds], ["a"]);
    assert.equal(tie.revisarIds.has("b"), true);
  });

  it("counts a third party identified by cuit, cvu, or name", () => {
    const rows = [
      row({ id: "cuit", description: `TRANSFERENCIA ${OTHER_CUIT}`, amountArs: "10" }),
      row({ id: "cvu", description: `TRANSFERENCIA ${OTHER_CVU}`, amountArs: "11" }),
      row({ id: "name", description: "PERSONA DEMO | TRANSFERENCIA INMEDIATA", amountArs: "12" }),
    ];
    const result = classify(rows, new Set([CUIT]), homes);
    assert.equal(result.thirdPartyIds.has("cuit"), true);
    assert.equal(result.thirdPartyIds.has("cvu"), true);
    assert.equal(result.thirdPartyIds.has("name"), true);
    assert.equal(result.internalIds.size, 0);
    assert.equal(result.revisarIds.size, 0);
  });

  it("flags a generic label as revisar", () => {
    const result = classify(
      [row({ id: "bare", description: "TRANSFERENCIA", amountArs: "40" })],
      new Set(),
      homes,
    );
    assert.equal(result.revisarIds.has("bare"), true);
    assert.equal(result.internalIds.has("bare"), false);
    assert.equal(result.thirdPartyIds.has("bare"), false);
  });

  it("counts a negative is_credit transfer as incoming by absolute value", () => {
    assert.equal(
      transferDirection(
        row({ id: "neg", description: "TRANSFERENCIA", amountArs: "-100", isCredit: 1, bank: "GALICIA" }),
      ),
      "incoming",
    );
    const result = classify(
      [
        row({ id: "out", bank: "BBVA", description: "TRANSFERENCIA", amountArs: "100" }),
        row({
          id: "inn",
          bank: "GALICIA",
          description: "TRANSFERENCIA",
          amountArs: "-100",
          isCredit: 1,
        }),
      ],
      new Set(),
      homes,
    );
    assert.equal(result.internalIds.has("out"), true);
    assert.equal(result.revisarIds.has("out"), false);

    const ownCredit = classify(
      [
        row({ id: "out", bank: "BBVA", description: "TRANSFERENCIA", amountArs: "40" }),
        row({
          id: "own",
          bank: "GALICIA",
          description: "ACREDITACION CUENTA PROPIA",
          amountArs: "-40",
          isCredit: 1,
        }),
      ],
      new Set(),
      homes,
    );
    assert.equal(ownCredit.internalIds.has("out"), true);
  });

  it("does not let an unrelated credit cancel a transfer", () => {
    const result = classify(
      [
        row({ id: "out", bank: "BBVA", description: "TRANSFERENCIA", amountArs: "100" }),
        row({
          id: "dev",
          bank: "GALICIA",
          description: "DEVOLUCION COMPRA",
          amountArs: "100",
          isCredit: 1,
        }),
        row({
          id: "acred",
          bank: "MACRO",
          description: "ACREDITACION",
          amountArs: "-100",
          isCredit: 1,
        }),
      ],
      new Set(),
      homes,
    );
    assert.equal(result.internalIds.has("out"), false);
    assert.equal(result.revisarIds.has("out"), true);
  });

  it("lets one incoming credit cancel only one transfer", () => {
    const result = classify(
      [
        row({ id: "a", date: "2026-08-10", bank: "BBVA", description: "TRANSFERENCIA", amountArs: "100" }),
        row({ id: "b", date: "2026-08-10", bank: "GALICIA", description: "TRANSFERENCIA", amountArs: "100" }),
        row({
          id: "inn",
          date: "2026-08-10",
          bank: "MACRO",
          description: "TRANSFERENCIA",
          amountArs: "-100",
          isCredit: 1,
        }),
      ],
      new Set(),
      homes,
    );
    assert.equal(result.internalIds.size, 1);
    assert.equal(result.internalIds.has("a"), true);
    assert.equal(result.internalIds.has("b"), false);
    assert.equal(result.revisarIds.has("b"), true);
  });

  it("flags the 60k-style row as revisar when no twin is present", () => {
    const result = classify(
      [
        row({
          id: "k60",
          description: SIXTY_K,
          bank: "BBVA",
          amountArs: "60000",
          isPayment: 0,
          isCredit: 0,
        }),
      ],
      new Set(),
      homes,
    );
    assert.equal(result.revisarIds.has("k60"), true);
    assert.equal(result.internalIds.has("k60"), false);
    assert.equal(result.thirdPartyIds.has("k60"), false);
  });
});
