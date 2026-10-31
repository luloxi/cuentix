type CacheEntry = { at: number; data: unknown };

const cache = new Map<string, CacheEntry>();

export type ApiResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
};

export async function apiGet<T>(path: string, ttlMs = 8000): Promise<ApiResult<T>> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttlMs) {
    return { ok: true, status: 200, data: hit.data as T };
  }
  const res = await fetch(path, { credentials: "include" });
  const data = (await res.json().catch(() => null)) as T | null;
  if (res.ok && data) cache.set(path, { at: Date.now(), data });
  return { ok: res.ok, status: res.status, data };
}

export function invalidateApi(prefix = "/api/"): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
