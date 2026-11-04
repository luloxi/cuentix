"use client";

/**
 * @deprecated Tab changes are driven by SectionSwipe + URL `?tab=`.
 * Kept as a no-op-friendly helper if a view still spreads it.
 */
export function useSwipeTabs<T extends string>(opts: {
  tabs: readonly T[];
  value: T;
  onChange: (v: T) => void;
  threshold?: number;
}) {
  // Tab changes are driven by SectionSwipe + the URL. The argument stays so
  // existing call sites keep type-checking.
  void opts;
  return {
    onTouchStart: undefined as undefined,
    onTouchEnd: undefined as undefined,
  };
}
