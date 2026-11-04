/**
 * No feature flags. Every section ships visible, even if incomplete.
 * Deuda (Casita card + /deuda) is always on; the old
 * NEXT_PUBLIC_DEUDA_ENABLED switch is gone and the env var is ignored.
 * Deuda stays off the nav (see nav.ts) and is reached from Inicio
 * and the swipe path.
 */
export function isDeudaEnabled(value?: string | undefined): boolean {
  // The old NEXT_PUBLIC_DEUDA_ENABLED value is ignored. The argument stays
  // so existing callers and tests can keep passing it.
  void value;
  return true;
}

export const DEUDA_ENABLED = true;
