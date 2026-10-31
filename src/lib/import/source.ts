import { BANKS, normalizeBank } from "@/lib/banks";

export type StatementFileKind = "pdf" | "xlsx" | "xls" | "csv" | "unknown";

export {
  STATEMENT_FILE_ACCEPT,
  filesFromDrop,
  isStatementFileName,
  statementFileRejectMessage,
} from "@/lib/import/file-accept";

/** Underscore/hyphen count as separators (JS \\b treats _ as a word char). */
const SEP = String.raw`(?:^|[^a-záéíóúñ0-9])`;
const END = String.raw`(?:[^a-záéíóúñ0-9]|$)`;

const BANK_ALIASES: Array<{ bank: (typeof BANKS)[number]; re: RegExp }> = [
  { bank: "BBVA", re: new RegExp(`${SEP}bbva${END}`, "i") },
  { bank: "Fiwind", re: new RegExp(`${SEP}fiwind${END}`, "i") },
  { bank: "Galicia", re: new RegExp(`${SEP}galicia${END}`, "i") },
  { bank: "Santander", re: new RegExp(`${SEP}santander${END}`, "i") },
  { bank: "Macro", re: new RegExp(`${SEP}macro${END}`, "i") },
  { bank: "Nación", re: new RegExp(`${SEP}naci[oó]n${END}`, "i") },
  { bank: "Provincia", re: new RegExp(`${SEP}provincia${END}`, "i") },
  { bank: "ICBC", re: new RegExp(`${SEP}icbc${END}`, "i") },
  { bank: "HSBC", re: new RegExp(`${SEP}hsbc${END}`, "i") },
  { bank: "Brubank", re: new RegExp(`${SEP}brubank${END}`, "i") },
  { bank: "Mercado Pago", re: new RegExp(`${SEP}mercado\\s*pago${END}`, "i") },
  { bank: "Ualá", re: new RegExp(`${SEP}ual[aá]${END}`, "i") },
  { bank: "Naranja X", re: new RegExp(`${SEP}naranja${END}`, "i") },
];

export function detectFileKind(
  buffer: Buffer,
  fileName?: string,
): StatementFileKind {
  const name = fileName?.toLowerCase() ?? "";
  if (name.endsWith(".pdf") || looksLikePdfBytes(buffer)) return "pdf";
  if (name.endsWith(".csv") || name.endsWith(".txt")) return "csv";
  if (name.endsWith(".xlsx")) return "xlsx";
  if (name.endsWith(".xls")) return "xls";
  if (looksLikePdfBytes(buffer)) return "pdf";
  if (looksLikeZip(buffer)) return "xlsx";
  if (looksLikeOle(buffer)) return "xls";
  if (looksLikeTextTable(buffer)) return "csv";
  return "unknown";
}

export function looksLikePdfBytes(buffer: Buffer): boolean {
  return (
    buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-"
  );
}

function looksLikeZip(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function looksLikeOle(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0
  );
}

function looksLikeTextTable(buffer: Buffer): boolean {
  if (buffer.length < 8) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 800));
  // NUL bytes → binary
  if (sample.includes(0)) return false;
  const text = sample.toString("utf8");
  if (!/[\r\n]/.test(text)) return false;
  return /[;,\t]/.test(text);
}

export function detectBankFromFileName(
  fileName: string | null | undefined,
): string | null {
  if (!fileName) return null;
  return detectBankFromText(fileName);
}

export function detectBankFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const { bank, re } of BANK_ALIASES) {
    if (re.test(text)) return bank;
  }
  return null;
}

function foldHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fiwind Actividad Excel: sheet "Actividad" + Fecha | Tipo | Monto | Moneda
 * (filename is often actividad-1.xlsx, no "fiwind" in it).
 */
export function detectFiwindActividadLayout(opts: {
  fileName?: string | null;
  sheetNames?: string[];
  headers?: string[];
}): boolean {
  if (detectBankFromFileName(opts.fileName) === "Fiwind") return true;
  const sheets = (opts.sheetNames ?? []).map((s) => s.toLowerCase());
  const headers = (opts.headers ?? []).map(foldHeader);
  const hasActividad = sheets.some((s) => s.includes("actividad"));
  const hasTipo = headers.some((h) => h === "tipo" || h.startsWith("tipo "));
  const hasFecha = headers.some((h) => h.includes("fecha"));
  const hasMoneda = headers.some(
    (h) => h === "moneda" || h.startsWith("moneda "),
  );
  const hasMonto = headers.some((h) => h === "monto" || h.startsWith("monto "));
  if (headers.some((h) => h.includes("establecimiento"))) return false;
  if (hasActividad && hasFecha && hasTipo && hasMoneda) return true;
  if (hasFecha && hasTipo && hasMonto && hasMoneda) return true;
  return false;
}

/**
 * User pick wins unless they left the default (BBVA) and the file clearly
 * belongs to another bank (typical: Fiwind Excel imported with BBVA selected).
 */
export function resolveImportBank(opts: {
  selected?: string | null;
  detected?: string | null;
  fileName?: string | null;
}): string {
  const fromName = detectBankFromFileName(opts.fileName);
  const detected = opts.detected || fromName;
  const selected = normalizeBank(opts.selected);

  if (selected && selected !== "BBVA") return selected;
  if (detected && detected !== "BBVA") return detected;
  if (selected) return selected;
  if (detected) return detected;
  return "BBVA";
}

export function statementTypeLabel(
  source: string,
  bank: string | null | undefined,
): string {
  const bankName = bank?.trim() || null;
  const withBank = (base: string, fallbackBank?: string) => {
    const b = bankName || fallbackBank || null;
    return b ? `${base} (${b})` : base;
  };

  switch (source) {
    case "bbva_pdf":
      return withBank("Resumen PDF", bankName ? undefined : "BBVA");
    case "bbva_xlsx":
      return withBank("Movimientos Excel", bankName ? undefined : "BBVA");
    case "bbva_period":
      return withBank("Movimientos del período", bankName ? undefined : "BBVA");
    case "xlsx":
    case "xls":
      return withBank("Movimientos Excel");
    case "csv":
      return withBank("Movimientos CSV");
    case "pdf":
    case "statement_pdf":
      return withBank("Resumen PDF");
    case "pdf_ai":
      return withBank("Resumen PDF (IA)");
    case "transparencia_xlsx":
      return "Transparencia Excel";
    case "invoice_iog":
      return "Invoice IOG";
    case "casita_csv":
      // Historic seed source code; never imply the whole bank extract is Casita.
      return withBank("Movimientos CSV", bankName ? undefined : "Fiwind");
    case "casita_hogar_utilities":
      return "Servicios hogar (Casita)";
    default:
      return bankName ? `Importación (${bankName})` : "Resumen / importación";
  }
}

/** Period xls / resumen PDF feed Deuda / cuotas, not gastos neta. */
export function isPeriodDebtSource(
  source: string | null | undefined,
): boolean {
  return source === "bbva_period" || source === "bbva_pdf";
}

export function statementTxSource(source: string): string {
  switch (source) {
    case "bbva_period":
      return "bbva_period";
    case "bbva_pdf":
      return "bbva_pdf";
    case "pdf_ai":
      return "statement_pdf";
    case "pdf":
    case "statement_pdf":
      return "statement_pdf";
    case "csv":
      return "csv_import";
    case "xlsx":
    case "xls":
      return "xlsx_import";
    default:
      return "bbva_import";
  }
}

export function emptyParseMessage(opts: {
  fileName?: string;
  fileKind: StatementFileKind | string;
  pdfTextLength?: number;
}): { message: string; hint: string } {
  const name = opts.fileName?.trim() || "el archivo";
  if (opts.fileKind === "pdf" && (opts.pdfTextLength ?? 0) < 40) {
    return {
      message: `No se leyeron movimientos de “${name}”. El PDF no tiene texto seleccionable (parece una foto).`,
      hint: "Si el banco AR no deja bajar el resumen: en la web, Imprimir → Guardar como PDF (no una captura). O pedí el Excel/CSV de movimientos. BBVA: Tarjetas → Últimos movimientos. Fiwind: Actividad → exportar.",
    };
  }
  if (opts.fileKind === "pdf") {
    return {
      message: `No se leyeron movimientos de “${name}”. No encontramos filas con fecha e importe.`,
      hint: "Probá el Excel o CSV de movimientos, o pegá el texto del resumen en el campo text del import. Si no hay descarga: imprimí el resumen a PDF desde la web.",
    };
  }
  if (opts.fileKind === "csv") {
    return {
      message: `No se leyeron movimientos de “${name}”. El CSV no tiene columnas de Fecha + Descripción/Importe.`,
      hint: "La primera fila tiene que ser encabezado (Fecha, Concepto/Descripción, Monto). Separador coma o punto y coma. Fiwind y BBVA exportan así.",
    };
  }
  return {
    message: `No se leyeron movimientos de “${name}”. Falta una tabla con Fecha y Descripción/Importe.`,
    hint: "BBVA: home banking → Tarjetas → Últimos movimientos (Excel) o Resumen (PDF). Fiwind: app → Actividad (Excel/CSV/PDF). Si el banco no da archivo: Imprimir → Guardar como PDF.",
  };
}
