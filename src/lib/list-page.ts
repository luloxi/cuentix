/** Page index after a filter change, clamped into 1..totalPages. */
export function nextPage(input: {
  filterChanged: boolean;
  page: number;
  totalPages: number;
}): number {
  const total = Math.max(1, input.totalPages);
  const base = input.filterChanged ? 1 : input.page;
  if (base > total) return total;
  if (base < 1) return 1;
  return base;
}

/**
 * Keep the selected month when it still exists.
 * Otherwise prefer `now`, then the first loaded period, then `now`.
 */
export function pickFilterPeriod(
  prev: string,
  periods: readonly string[],
  now: string,
): string {
  if (prev !== "all" && periods.includes(prev)) return prev;
  if (periods.includes(now)) return now;
  if (periods.length > 0) return periods[0]!;
  return now;
}
