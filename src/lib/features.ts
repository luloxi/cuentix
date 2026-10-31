/**
 * Deuda is rebuilt around open cuotas + the latest card snapshot.
 * Default on. Set NEXT_PUBLIC_DEUDA_ENABLED=0 to hide the Casita card
 * and /deuda. Nav never includes Deuda.
 */
export function isDeudaEnabled(
  value: string | undefined = process.env.NEXT_PUBLIC_DEUDA_ENABLED,
): boolean {
  if (value == null || value === "") return true;
  return value === "1" || value === "true";
}

export const DEUDA_ENABLED = isDeudaEnabled();
