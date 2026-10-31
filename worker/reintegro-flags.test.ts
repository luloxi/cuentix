/**
 * Oracle: the payee matcher as it worked before groups became an argument.
 * The old code parsed the raw config string from the environment. These
 * copies take that string directly. The bodies are otherwise unchanged.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reintegroFlags } from "./reintegro-flags";

function oracleParse(raw: string | undefined | null): string[][] {
  return String(raw ?? "")
    .toUpperCase()
    .split(",")
    .map((g) =>
      g
        .split("+")
        .map((t) => t.replace(/[^A-Z0-9]/g, ""))
        .filter(Boolean),
    )
    .filter((g) => g.length > 0);
}

const OUTBOUND_PAY_PREFIX =
  /^(RETIRO|PAGO|TRANSFERENCIA|TRANSFER|ENVIO)\s+A\b/;

function oracleNormalize(description: string): string {
  return description
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function oracleLooksLike(description: string, groups: string[][]): boolean {
  const key = oracleNormalize(description);
  if (!key) return false;
  if (!OUTBOUND_PAY_PREFIX.test(key)) return false;
  return groups.some((g) =>
    g.every((t) => new RegExp(`\\b${t}\\b`).test(key)),
  );
}

function oracleBare(description: string, groups: string[][]): boolean {
  const key = oracleNormalize(description);
  if (!key) return false;
  if (OUTBOUND_PAY_PREFIX.test(key)) return false;
  for (const g of groups) {
    const head = g.join(" ");
    if (key === head) return true;
    if (g.length < 2 || !key.startsWith(head + " ")) continue;
    const after = key.slice(head.length).trim();
    if (
      /\b(EN|EL|LA|LOS|LAS|DE|DEL|AL|SUPER|MARKET|TIENDA|FARMAC|STEAM|PAGO|RETIRO|UNA|CUENTA)\b/.test(
        after,
      )
    ) {
      continue;
    }
    if (after.split(" ").every((t) => t.length >= 3)) return true;
  }
  return false;
}

function oracleFlags(description: string, raw: string | undefined | null) {
  const groups = oracleParse(raw);
  const reintegroPayee = oracleLooksLike(description, groups);
  return {
    reintegroHogar: reintegroPayee || oracleBare(description, groups),
    reintegroPayee,
  };
}

const DESCRIPTIONS = [
  "Retiro a Ana Lopez",
  "PAGO A ANITA",
  "  pagó a  ánà   lópez ",
  "Ana Lopezzz",
  "ANALOPEZ",
  "Ana Lopez",
  "Anita",
  "Ana Lopez en el super",
  "PAGO A DIA",
];

describe("reintegroFlags matches the original algorithm", () => {
  const configs: Array<string | undefined> = [
    "ANA+LOPEZ,ANITA",
    "ana+lopez,anita",
    "Ana+Lopez!, Anita.",
    "",
    undefined,
  ];

  for (const raw of configs) {
    const label = raw === undefined ? "undefined" : JSON.stringify(raw);
    it(`config ${label}`, () => {
      for (const description of DESCRIPTIONS) {
        assert.deepEqual(
          reintegroFlags(description, raw),
          oracleFlags(description, raw),
          description,
        );
      }
    });
  }

  it("lowercase and punctuation parse like the canonical fake config", () => {
    for (const description of DESCRIPTIONS) {
      const canonical = oracleFlags(description, "ANA+LOPEZ,ANITA");
      assert.deepEqual(reintegroFlags(description, "ana+lopez,anita"), canonical);
      assert.deepEqual(
        reintegroFlags(description, "Ana+Lopez!, Anita."),
        canonical,
      );
    }
  });

  it("empty and unset payees are false/false", () => {
    for (const description of DESCRIPTIONS) {
      assert.deepEqual(reintegroFlags(description, ""), {
        reintegroHogar: false,
        reintegroPayee: false,
      });
      assert.deepEqual(reintegroFlags(description, undefined), {
        reintegroHogar: false,
        reintegroPayee: false,
      });
      assert.deepEqual(reintegroFlags(description, null), {
        reintegroHogar: false,
        reintegroPayee: false,
      });
    }
  });

  it("prefix, bare, and negative rows stay distinct", () => {
    const raw = "ANA+LOPEZ,ANITA";
    assert.deepEqual(reintegroFlags("Retiro a Ana Lopez", raw), {
      reintegroHogar: true,
      reintegroPayee: true,
    });
    assert.deepEqual(reintegroFlags("PAGO A ANITA", raw), {
      reintegroHogar: true,
      reintegroPayee: true,
    });
    assert.deepEqual(reintegroFlags("  pagó a  ánà   lópez ", raw), {
      reintegroHogar: true,
      reintegroPayee: true,
    });
    assert.deepEqual(reintegroFlags("Ana Lopez", raw), {
      reintegroHogar: true,
      reintegroPayee: false,
    });
    assert.deepEqual(reintegroFlags("Ana Lopez en el super", raw), {
      reintegroHogar: false,
      reintegroPayee: false,
    });
    assert.deepEqual(reintegroFlags("Ana Lopezzz", raw), {
      reintegroHogar: false,
      reintegroPayee: false,
    });
    assert.deepEqual(reintegroFlags("ANALOPEZ", raw), {
      reintegroHogar: false,
      reintegroPayee: false,
    });
    assert.deepEqual(reintegroFlags("PAGO A DIA", raw), {
      reintegroHogar: false,
      reintegroPayee: false,
    });
  });
});
