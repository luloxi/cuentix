/**
 * No feature flags. Every section ships visible, even if incomplete.
 * Deuda (Casita card + /deuda) is always on; the old
 * NEXT_PUBLIC_DEUDA_ENABLED switch is gone and the env var is ignored.
 * The bottom nav stays the canonical 5 items (see nav.ts); Deuda is reached
 * from Inicio and the swipe path.
 */
export function isDeudaEnabled(_value?: string | undefined): boolean {
  return true;
}

export const DEUDA_ENABLED = true;
