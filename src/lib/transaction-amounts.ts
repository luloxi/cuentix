/**
 * Normalize amount fields for UPDATE.
 * - key omitted / undefined → leave DB value unchanged
 * - null → clear column
 * - number → store abs as numeric string
 *
 * Cubierto / Reintegro PATCH must not pass amountArs: undefined in a way that
 * clears montos — Resumen Cubiertos would then sum $0 while neta still drops.
 */
export function resolveAmountUpdates(patch: {
  amountArs?: number | null;
  amountUsd?: number | null;
}): { amountArs?: string | null; amountUsd?: string | null } {
  const out: { amountArs?: string | null; amountUsd?: string | null } = {};
  if (patch.amountArs !== undefined) {
    if (patch.amountArs == null) {
      out.amountArs = null;
    } else {
      const n = Number(patch.amountArs);
      if (Number.isNaN(n)) throw new Error("Monto $ inválido");
      out.amountArs = String(Math.abs(n));
    }
  }
  if (patch.amountUsd !== undefined) {
    if (patch.amountUsd == null) {
      out.amountUsd = null;
    } else {
      const n = Number(patch.amountUsd);
      if (Number.isNaN(n)) throw new Error("Monto USD inválido");
      out.amountUsd = String(Math.abs(n));
    }
  }
  return out;
}
