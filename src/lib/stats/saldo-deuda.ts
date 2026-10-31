/**
 * Rainman: card debt source of truth is editable `saldo_deuda` (ARS + optional USD).
 * Parse one saldo line from a card statement (BBVA resumen / Fiwind tarjeta).
 * CA$ checking balance is NOT debt — only card "saldo actual" / "total a pagar".
 */

import { parseBbvaAmount } from "@/lib/money";

export type CardStatementSaldo = {
  ars: number;
  usd: number | null;
};

function fold(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Reject CA$ / cuenta corriente checking balances. */
function looksLikeCheckingBalance(line: string): boolean {
  const u = fold(line);
  if (/\bCA\$\b/.test(u) || /\bCA\s*\$/.test(u)) return true;
  if (/\bCUENTA\s+(CORRIENTE|CAJA|AHORRO)\b/.test(u)) return true;
  if (/\bSALDO\s+(DISPONIBLE|EN\s+CUENTA|CAJA)\b/.test(u)) return true;
  if (/\bDISPONIBLE\b/.test(u) && !/\bTARJETA\b/.test(u)) return true;
  return false;
}

function isCardSaldoLabel(line: string): boolean {
  const u = fold(line);
  if (looksLikeCheckingBalance(u)) return false;
  if (/\bSALDO\s+ANTERIOR\b/.test(u)) return false;
  if (/\bSALDO\s+FINANCIABLE\b/.test(u)) return false;
  if (/\bTOTAL\s+CONSUMOS\b/.test(u)) return false;
  if (/\bTRANSFERENCIA\s+DEUDA\b/.test(u)) return false;
  if (/\bSALDO\s+ACTUAL\b/.test(u)) return true;
  if (/\bTOTAL\s+A\s+PAGAR\b/.test(u)) return true;
  if (/\bSALDO\s+DE\s+LA\s+TARJETA\b/.test(u)) return true;
  if (/\bDEUDA\s+TOTAL\b/.test(u)) return true;
  if (/\bPAGO\s+TOTAL\b/.test(u) && /\bTARJETA\b/.test(u)) return true;
  return false;
}

/**
 * Parse Argentine amounts from a label line, e.g.
 * "SALDO ACTUAL 2.895.037,06 20,09" → { ars: 2895037.06, usd: 20.09 }
 */
export function parseCardStatementSaldoFromText(
  text: string,
): CardStatementSaldo | null {
  if (!text?.trim()) return null;
  const lines = text.split(/\r?\n/);
  let best: CardStatementSaldo | null = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line || !isCardSaldoLabel(line)) continue;

    // Prefer lines that carry amounts on the same row (not bare "SALDO ACTUAL $").
    const moneyRe = /-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2}|-?\d{1,3}(?:,\d{3})*\.\d{2}/g;
    const tokens = line.match(moneyRe) ?? [];
    if (tokens.length === 0) continue;

    const amounts: number[] = [];
    for (const t of tokens) {
      const parsed = parseBbvaAmount(t);
      if (parsed && Number.isFinite(parsed.value)) {
        amounts.push(Math.abs(parsed.value));
      }
    }
    if (amounts.length === 0) continue;

    const ars = amounts[0]!;
    // Heuristic: second amount on SALDO ACTUAL lines is USD when small vs ARS
    // or when line mentions U$S / USD.
    let usd: number | null = null;
    const u = fold(line);
    if (amounts.length >= 2) {
      const second = amounts[1]!;
      if (/\bU\$S\b/.test(u) || /\bUSD\b/.test(u) || second < ars * 0.01 || second < 5000) {
        usd = second;
      }
    }

    // Prefer the last matching SALDO ACTUAL with amounts (statement footer).
    best = { ars, usd };
  }

  return best;
}

/** Scan spreadsheet rows (joined cells) for a card saldo line. */
export function parseCardStatementSaldoFromRows(
  rows: Array<Array<unknown>>,
): CardStatementSaldo | null {
  const lines: string[] = [];
  for (const row of rows) {
    const cells = row.map((c) => String(c ?? "").trim()).filter(Boolean);
    if (cells.length === 0) continue;
    lines.push(cells.join(" "));
  }
  return parseCardStatementSaldoFromText(lines.join("\n"));
}

/** True when the user (or import) has set a saldo_deuda source of truth. */
export function hasSaldoDeuda(settings?: {
  saldoDeudaArs?: number | null;
  saldoDeudaUsd?: number | null;
} | null): boolean {
  if (!settings) return false;
  return settings.saldoDeudaArs != null || settings.saldoDeudaUsd != null;
}
