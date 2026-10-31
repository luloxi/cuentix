import { isFiwindNonExpenseTipo } from "@/lib/import/fiwind";

/** Fold accents / whitespace for transfer phrase matching. */
function foldDesc(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strip bank / account-channel prefixes so we can match bare memos like
 * "BBVA CA$ TRANSFERENCIA" → "TRANSFERENCIA".
 */
function coreTransferMemo(u: string): string {
  return u
    .replace(
      /^(BBVA|GALICIA|SANTANDER|MACRO|BRUBANK|BBNK|FIWIND|MERCADOPAGO|MP)\b/,
      "",
    )
    // CA$ / CA — "$" is non-word so \b after it fails; allow either form.
    .replace(/\bCA\$?(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Argentine CUIT/CUIL: 11 digits, optional dashes. */
function extractCuits(u: string): string[] {
  const out: string[] = [];
  const re = /\b(\d{2})-?(\d{8})-?(\d)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(u)) !== null) {
    out.push(`${m[1]}${m[2]}${m[3]}`);
  }
  return out;
}

/**
 * Own FX / currency conversion on the same wallet or bank — not ingreso.
 * Rainman: Cambio de moneda (~680k / 1.507M / 1.381M) → Transferencia interna.
 */
export function isOwnFxConversionDescription(description: string): boolean {
  const u = foldDesc(description);
  if (!u) return false;
  if (u.includes("CAMBIO DE MONEDA")) return true;
  if (u.includes("CAMBIO MONEDA")) return true;
  if (/\bOPERACION(ES)?\s+DE\s+CAMBIO\b/.test(u)) return true;
  if (/\bOPERACION(ES)?\s+CAMBIO\b/.test(u)) return true;
  // BBVA / home-banking FX tickets
  if (/\bCOMPRA\s+ME\b/.test(u) || /\bVENTA\s+ME\b/.test(u)) return true;
  if (u.includes("ARBOLITO") || u.includes("COTIZACION")) return false;
  return false;
}

/**
 * Own-account / internal wallet moves — not gasto nor ingreso.
 * Covers Fiwind “A/De una cuenta tuya”, BBVA entre-cuentas / cuenta propia,
 * Transferencia inmediata (self), bare TRANSFERENCIA, TRANSF. CLIENTE CTA. CAP,
 * BBVA CR TRF / CR TBE / INM COE credit tickets, same-CUIT self transfers,
 * BBNK self, and own FX (Cambio de moneda).
 *
 * Rainman: money already yours changing pockets ≠ income.
 * Optional `holderCuit` (11 digits): CUIT in the memo matching the titular → interno.
 * BBVA credit-transfer tickets (CR TRF / CR TBE / INM COE) → Transferencia interna.
 * Keeps named third-party income (Mauro, salary, …).
 */
export function isOwnAccountTransferDescription(
  description: string,
  opts?: { holderCuit?: string | null },
): boolean {
  const u = foldDesc(description);
  if (!u) return false;

  // Fiwind / BBVA explicit own-account
  if (/\b(A|DE)\s+(UNA\s+)?CUENTA\s+TUYA\b/.test(u)) return true;
  if (u.includes("CUENTA PROPIA")) return true;
  if (u.includes("ENTRE CUENTAS") || u.includes("TRANSF ENTRE CUENTAS")) return true;
  if (u.includes("CTA A CTA") || u.includes("CUENTA A CUENTA")) return true;
  if (u.startsWith("TRANSFERENCIA INTERNA")) return true;
  if (u.includes("TRANSFERENCIA A CUENTA PROPIA") || u.includes("TRANSF A CUENTA PROPIA"))
    return true;

  // Own FX
  if (isOwnFxConversionDescription(u)) return true;

  // Mercado Pago / BBVA instant self: "Transferencia inmediata"
  // (01/09 +800k, 1.924M, 1.9M) — never Ingresos Variables.
  if (u.includes("TRANSFERENCIA INMEDIATA")) return true;

  // BBVA CA$ credit-transfer labels — Rainman FAIL fix:
  // CR TRF / CR TBE / INM COE (e.g. "CR TBE INM COE", "CR TRF INM COE" $300k)
  // always Transferencia interna, never Ingresos Variables.
  if (/\bCR\s+(TRF|TBE)\b/.test(u)) return true;
  if (/\bINM\s+COE\b/.test(u)) return true;

  // BBVA own-pocket: TRANSF. CLIENTE CTA. CAP093 … (05/06 +566k)
  if (/\bTRANSF\.?\s*CLIENTE\b/.test(u) && /\bCTA\.?\b/.test(u)) return true;
  if (/\bCTA\.?\s*CAP\d*\b/.test(u)) return true;

  // Same CUIT twice in the memo (sender == receiver)
  const cuits = extractCuits(u);
  if (cuits.length >= 2 && cuits.some((c, i) => cuits.indexOf(c) !== i)) {
    return true;
  }

  // Titular CUIT present on a transfer/credit line → self
  const holder = (opts?.holderCuit ?? "").replace(/\D/g, "");
  if (holder.length === 11 && cuits.includes(holder)) {
    if (
      u.includes("TRANSFERENCIA") ||
      u.includes("TRANSF ") ||
      u.includes("CREDITO") ||
      u.includes("ACREDIT") ||
      u.includes("DEBIN")
    ) {
      return true;
    }
  }

  // BBNK (Brubank) self-move heuristics
  if (/\bBBNK\b/.test(u) && (u.includes("TRANSFERENCIA") || u.includes("TRANSF"))) {
    return true;
  }
  // “DE / A” + own bank short codes often used for pocket moves
  if (
    /\b(TRANSFERENCIA|TRANSF)\b/.test(u) &&
    /\b(MISMO TITULAR|MISMO CLIENTE|PROPIA|SELF)\b/.test(u)
  ) {
    return true;
  }

  // Bare "TRANSFERENCIA" (± amount / nro) after stripping BBVA CA$ — Rainman
  // 29/05 +306333.80 and 07/05 +200k. Counterparty names stay out.
  const core = coreTransferMemo(u);
  if (
    /^TRANSFERENCIA(\s+\d[\d.,]*)?$/.test(core) ||
    /^TRANSFERENCIA(\s+NRO\.?:?\s*\d+)?$/.test(core)
  ) {
    return true;
  }

  return false;
}

/**
 * Alias Rainman language: Transferencia interna (never Ingresos).
 * Same detector as own-account + FX.
 */
export function isInternalTransferDescription(
  description: string,
  opts?: { holderCuit?: string | null },
): boolean {
  return isOwnAccountTransferDescription(description, opts);
}

/**
 * Labels that must never appear as Ingresos Variables.
 * Real income (Mauro, salary, interest) stays; BBVA CR TRF/TBE INM COE does not.
 */
export function isNonIncomeTransferLabel(
  label: string,
  opts?: { holderCuit?: string | null },
): boolean {
  const u = foldDesc(label);
  if (!u) return false;
  if (isInternalTransferDescription(u, opts)) return true;
  // Card payments / DEBIN are not income (they reduce debt)
  if (isCardPaymentEntry(u)) return true;
  if (/\bDEBIN\b/.test(u)) return true;
  if (/\bPAGO\s+VISA\b/.test(u) || /\bPAGO\s+MASTER\b/.test(u)) return true;
  return false;
}

/**
 * Tipo "Transferencia interna" — isPayment + category, stays visible in Consumos
 * (out of neta) like Cubierto / Reintegro hogar.
 */
export function isTransferenciaInternaTipo(
  isPayment: boolean,
  category?: { slug?: string | null; name?: string | null } | null,
  descriptionNormalized?: string | null,
): boolean {
  if (!isPayment) return false;
  const slug = (category?.slug ?? "").trim().toLowerCase();
  if (slug === "transferencia-interna") return true;
  const name = foldDesc(category?.name ?? "");
  if (name === "TRANSFERENCIA INTERNA") return true;
  if (
    descriptionNormalized &&
    isInternalTransferDescription(descriptionNormalized)
  ) {
    return true;
  }
  return false;
}

/**
 * Statement lines that are accounting (not real consumption).
 * BBVA: pesificación, debt transfers, USD interest credits.
 * Fiwind: USDC↔ARS conversions, Compra/Venta KO, yields, deposits, crypto out,
 * wallet TRANSFERENCIA ARS, own-account “cuenta tuya”, FX, and amount-only Tipo.
 * They must not inflate “gastos” totals in Análisis / Consumos.
 * COMPRA SUPER ARS is grocery spend, not an investment.
 */
export function isBankAccountingEntry(description: string): boolean {
  if (isOwnAccountTransferDescription(description)) return true;
  const u = description.toUpperCase();
  if (
    u.includes("PESIFICACION") ||
    u.includes("PESIFICACIÓN") ||
    u.includes("TRANSFERENCIA DEUDA") ||
    u.includes("CREDITOS VS EN USD") ||
    u.includes("CRÉDITOS VS EN USD") ||
    u.includes("CREDITO VS EN USD") ||
    u.includes("TRANSF. DEUDA") ||
    u.includes("TRANSF DEUDA")
  ) {
    return true;
  }
  return isFiwindNonExpenseTipo(description);
}

/** Card payments the user made (reduces debt). Paying card from CA reduces debt. */
export function isCardPaymentEntry(description: string): boolean {
  const u = description
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  return (
    u.includes("SU PAGO") ||
    u.includes("PAGO EN PESOS") ||
    u.includes("PAGO EN USD") ||
    u.includes("PAGO RECIBIDO") ||
    u.includes("PAGO DE TARJETA") ||
    u.includes("PAGO TARJETA") ||
    u.includes("PAGO VISA") ||
    u.includes("PAGO MASTER") ||
    u.includes("PAGO AMEX") ||
    u.includes("DEBITO AUTOMATICO") ||
    u.includes("DEB. AUTOMATICO") ||
    u.includes("DEB AUTOMATICO") ||
    u.includes("DEBITO AUT.") ||
    u.includes("PAGO FACIL") ||
    u.includes("PAGO MIS CUENTAS") ||
    // DEBIN to card / Visa payment from CA — not income
    /\bDEBIN\b/.test(u) ||
    // Generic “PAGO …” — not Fiwind “Pago a DIA” (merchant purchase)
    (/^PAGO\b/.test(u.trim()) && !/^PAGO\s+A\b/.test(u.trim())) ||
    /\bSU\s+PAGO\b/.test(u)
  );
}
