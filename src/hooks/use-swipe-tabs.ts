"use client";

/**
 * @deprecated Tab changes are driven by SectionSwipe + URL `?tab=`.
 * Kept as a no-op-friendly helper if a view still spreads it.
 */
export function useSwipeTabs<T extends string>(_opts: {
  tabs: readonly T[];
  value: T;
  onChange: (v: T) => void;
  threshold?: number;
}) {
  return {
    onTouchStart: undefined as undefined,
    onTouchEnd: undefined as undefined,
  };
}
