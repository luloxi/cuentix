"use client";

import { useEffect, useState } from "react";

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(String(status));
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin" });
  if (response.status === 401) {
    window.location.assign("/login/");
    throw new ApiError(401);
  }
  if (!response.ok) throw new ApiError(response.status);
  return (await response.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status === 401) {
    window.location.assign("/login/");
    throw new ApiError(401);
  }
  const payload = (await response.json().catch(() => null)) as { error?: string } | T | null;
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "error";
    throw new Error(message);
  }
  return payload as T;
}

export function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let gone = false;
    setLoading(true);
    setError(false);
    apiGet<T>(path)
      .then((json) => {
        if (gone) return;
        setData(json);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (gone || (reason instanceof ApiError && reason.status === 401)) return;
        setError(true);
        setLoading(false);
      });
    return () => {
      gone = true;
    };
  }, [path, tick]);

  return { data, error, loading, reload: () => setTick((value) => value + 1) };
}
