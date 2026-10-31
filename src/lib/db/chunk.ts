/** Cloudflare D1 allows at most 100 bound parameters per statement. */
export const D1_MAX_BOUND_PARAMS = 100;

export function chunkByBoundParams<T>(
  rows: readonly T[],
  paramsPerRow: number,
): T[][] {
  const size = Math.max(
    1,
    Math.floor(D1_MAX_BOUND_PARAMS / Math.max(1, paramsPerRow)),
  );
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    out.push(rows.slice(i, i + size));
  }
  return out;
}

/**
 * Run one query per slice so a large `IN (...)` stays under the bound-parameter
 * cap. `extraBoundParams` counts placeholders outside the list (typically 1).
 * Statements run sequentially. D1 has no interactive transaction around them.
 */
export async function mapInChunks<T, R>(
  values: readonly T[],
  extraBoundParams: number,
  run: (chunk: T[]) => Promise<R[]>,
): Promise<R[]> {
  if (values.length === 0) return [];
  const size = Math.max(1, D1_MAX_BOUND_PARAMS - extraBoundParams);
  const out: R[] = [];
  for (let i = 0; i < values.length; i += size) {
    const chunk = values.slice(i, i + size);
    out.push(...(await run(chunk)));
  }
  return out;
}
