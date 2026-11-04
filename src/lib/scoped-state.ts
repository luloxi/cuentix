/**
 * A value tagged with the scope it was set in (for example a month).
 * Reading it under another scope yields null, so a message from one scope
 * never shows in the next and no effect is needed to clear it.
 */
export type Scoped<T> = { scope: string; value: T };

export function scoped<T>(scope: string, value: T): Scoped<T> {
  return { scope, value };
}

export function readScoped<T>(entry: Scoped<T> | null, scope: string): T | null {
  return entry && entry.scope === scope ? entry.value : null;
}
