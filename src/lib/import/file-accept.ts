/**
 * Extensions only. Mixing MIME types into accept greys out .xlsx on some
 * desktop Chromes when the OS reports octet-stream / empty type.
 */
export const STATEMENT_FILE_ACCEPT = ".xlsx,.xls,.csv,.txt,.pdf";

const STATEMENT_NAME_RE = /\.(xlsx|xls|csv|txt|pdf)$/i;

export function isStatementFileName(name: string): boolean {
  return STATEMENT_NAME_RE.test(name.trim());
}

export function statementFileRejectMessage(name: string): string {
  const n = name.trim() || "el archivo";
  return `“${n}” no es Excel, CSV ni PDF. Fiwind: Actividad → exportar. BBVA: Últimos movimientos.`;
}

function filesFromDataTransfer(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return [];
  if (dt.files && dt.files.length > 0) return Array.from(dt.files);
  const out: File[] = [];
  if (dt.items) {
    for (const item of Array.from(dt.items)) {
      if (item.kind !== "file") continue;
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }
  return out;
}

/** Dropped files, including when `files` is empty but `items` has them. */
export function filesFromDrop(dt: DataTransfer | null | undefined): File[] {
  return filesFromDataTransfer(dt);
}
