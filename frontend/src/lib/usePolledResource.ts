"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface PolledResource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Re-fetch immediately (e.g. after a mutation). */
  reload: () => Promise<void>;
  /** Replace local data with a fresh server response (e.g. from a PATCH). */
  setData: (value: T) => void;
}

/**
 * Fetches a resource and re-polls it while `shouldPoll(data)` is true.
 * Polling pauses while the tab is hidden and resumes on focus. Errors keep
 * the last good data visible and are surfaced separately.
 */
export function usePolledResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: { intervalMs: number; shouldPoll: (data: T | null) => boolean; key: string },
): PolledResource<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  const shouldPollRef = useRef(options.shouldPoll);
  const controllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataRef = useRef<T | null>(null);
  fetcherRef.current = fetcher;
  shouldPollRef.current = options.shouldPoll;

  const schedule = useRef<() => void>(() => undefined);

  const load = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const value = await fetcherRef.current(controller.signal);
      if (controller.signal.aborted) return;
      dataRef.current = value;
      setDataState(value);
      setError(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Erro inesperado.");
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        schedule.current();
      }
    }
  }, []);

  schedule.current = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (!shouldPollRef.current(dataRef.current)) return;
    timerRef.current = setTimeout(() => void load(), options.intervalMs);
  };

  useEffect(() => {
    setLoading(true);
    dataRef.current = null;
    setDataState(null);
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      controllerRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [load, options.key]);

  const setData = useCallback((value: T) => {
    dataRef.current = value;
    setDataState(value);
    schedule.current();
  }, []);

  return { data, error, loading, reload: load, setData };
}
