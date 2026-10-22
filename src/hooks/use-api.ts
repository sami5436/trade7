"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    method: init?.method ?? (init?.json !== undefined ? "POST" : "GET"),
    headers: init?.json !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== "undefined" && !url.includes("/api/auth/")) {
    window.location.replace("/login");
  }
  if (!res.ok) throw new ApiError((data as { error?: string; message?: string }).error ?? (data as { message?: string }).message ?? "Request failed.", res.status);
  return data as T;
}

export function useApi<T>(url: string | null, intervalMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const active = useRef(true);

  const refresh = useCallback(async () => {
    if (!url) return;
    try {
      const next = await api<T>(url);
      if (!active.current) return;
      setData(next);
      setError(null);
    } catch (e) {
      if (active.current) setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      if (active.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    active.current = true;
    const first = setTimeout(refresh, 0);
    const id = intervalMs
      ? setInterval(() => {
          if (document.visibilityState === "visible") refresh();
        }, intervalMs)
      : undefined;
    return () => {
      active.current = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh, intervalMs]);

  return { data, error, loading, refresh, setData };
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
