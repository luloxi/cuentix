"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, type ApiResult } from "@/lib/api/client";

export function useApi<T>(path: string | null, ttlMs = 8000) {
  const [result, setResult] = useState<ApiResult<T> | null>(null);
  const [loading, setLoading] = useState(Boolean(path));

  const reload = useCallback(async () => {
    if (!path) {
      setResult(null);
      setLoading(false);
      return;
    }
    const next = await apiGet<T>(path, ttlMs).catch(
      (): ApiResult<T> => ({ ok: false, status: 0, data: null }),
    );
    setResult(next);
    setLoading(false);
  }, [path, ttlMs]);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    void apiGet<T>(path, ttlMs)
      .catch((): ApiResult<T> => ({ ok: false, status: 0, data: null }))
      .then((next) => {
        if (cancelled) return;
        setResult(next);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, ttlMs]);

  return { result, loading, reload };
}
