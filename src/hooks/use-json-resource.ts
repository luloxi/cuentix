"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ResourceState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Resolves when the refetch started by this call settles. */
  reload: () => Promise<void>;
};

export type ResourceOptions = {
  /**
   * After the first load, later fetches leave `loading` false so the previous
   * data stays on screen. Callers that need a spinner track their own flag.
   */
  staleWhileReload?: boolean;
  /** Message when the response is not ok and has no string `error`. */
  fallbackError?: string;
  /** Message when fetch throws something that is not an Error. */
  networkError?: string;
};

export type Waiter = {
  resolve: () => void;
  reject: (error: unknown) => void;
};

/** Error string from a JSON body, or `fallback` when the body has none. */
export function messageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const err = (body as { error?: unknown }).error;
    if (typeof err === "string" && err.trim()) return err;
  }
  return fallback;
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { name?: unknown }).name === "AbortError";
}

/** Parse a fetch Response. Throws Error with the API `error` string when not ok. */
export async function readJson<T>(
  res: Response,
  fallbackError: string,
): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch (e) {
      if (!res.ok) throw new Error(messageFromBody(null, fallbackError));
      throw e instanceof Error ? e : new Error(fallbackError);
    }
  }
  if (!res.ok) throw new Error(messageFromBody(body, fallbackError));
  return body as T;
}

/**
 * Settle the waiter for `token` and every older one. An older waiter whose
 * fetch never started (two reloads batched into one render) or was aborted
 * would otherwise hang its caller forever.
 */
export function settleWaiters(
  waiters: Map<number, Waiter>,
  token: number,
  error: unknown | undefined,
) {
  for (const [key, waiter] of [...waiters]) {
    if (key > token) continue;
    waiters.delete(key);
    if (error === undefined) waiter.resolve();
    else waiter.reject(error);
  }
}

/**
 * GET JSON with AbortController. setState runs only inside the fetch promise
 * callbacks, never synchronously in the effect body. `reload()` is for event
 * handlers (it may set loading immediately).
 */
export function useJsonResource<T>(
  url: string | null,
  deps: readonly unknown[] = [],
  options?: ResourceOptions,
): ResourceState<T> {
  const fallbackError = options?.fallbackError ?? "Error";
  const networkError = options?.networkError ?? "Error de red";
  const stale = options?.staleWhileReload ?? false;
  const requestKey = `${url ?? ""}\0${JSON.stringify(deps)}`;
  const active = url != null;

  const [seenKey, setSeenKey] = useState(requestKey);
  const [reloadToken, setReloadToken] = useState(0);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(active);

  const tokenRef = useRef(0);
  const waiters = useRef(new Map<number, Waiter>());

  if (requestKey !== seenKey) {
    setSeenKey(requestKey);
    setError(null);
    if (!active) {
      setData(null);
      setLoading(false);
    } else if (!stale) {
      setLoading(true);
    }
  }

  useEffect(() => {
    const token = reloadToken;
    const pending = waiters.current;
    if (!url) {
      settleWaiters(pending, token, undefined);
      return;
    }
    const ac = new AbortController();
    fetch(url, { credentials: "include", signal: ac.signal })
      .then((res) => readJson<T>(res, fallbackError))
      .then((body) => {
        if (ac.signal.aborted) return;
        setData(body);
        setError(null);
        setLoading(false);
        settleWaiters(waiters.current, token, undefined);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted || isAbortError(e)) return;
        const message =
          e instanceof Error && e.message ? e.message : networkError;
        setError(message);
        setLoading(false);
        settleWaiters(
          waiters.current,
          token,
          e instanceof Error ? e : new Error(message),
        );
      });
    return () => {
      ac.abort();
      // Aborted (url/deps changed, newer reload, or unmount): resolve so
      // `await reload()` callers continue instead of hanging.
      settleWaiters(pending, token, undefined);
    };
  }, [url, requestKey, reloadToken, fallbackError, networkError]);

  const reload = useCallback(() => {
    const token = ++tokenRef.current;
    setReloadToken(token);
    setError(null);
    if (!stale) setLoading(true);
    return new Promise<void>((resolve, reject) => {
      waiters.current.set(token, { resolve, reject });
    });
  }, [stale]);

  return { data, error, loading, reload };
}
