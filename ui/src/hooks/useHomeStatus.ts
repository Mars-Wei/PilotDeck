import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';

export type HomeServiceStatus = 'online' | 'degraded' | 'offline';

export type HomeStatusData = {
  timestamp: string;
  gateway: {
    status: HomeServiceStatus;
    checkedAt?: string;
    latencyMs?: number;
    error?: string;
  };
  mcp: {
    status: HomeServiceStatus;
    connected: number;
    total: number;
    global?: number;
    project?: number;
    hasConfig?: boolean;
    error?: string;
  };
  memory: {
    status: HomeServiceStatus;
    scheduler?: {
      enabled: boolean;
      running: boolean;
      intervalMs: number | null;
    };
    error?: string;
  };
};

type UseHomeStatusOptions = {
  initialDelayMs?: number;
  pollIntervalMs?: number;
};

const DEFAULT_POLL_INTERVAL_MS = 60_000;

async function readHomeStatus(): Promise<HomeStatusData> {
  const response = await api.homeStatus();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return await response.json() as HomeStatusData;
}

export function useHomeStatus({
  initialDelayMs = 0,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: UseHomeStatusOptions = {}) {
  const [data, setData] = useState<HomeStatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const hasFetchedRef = useRef(false);

  const refresh = useCallback(async () => {
    const isInitial = !hasFetchedRef.current;
    if (isInitial) setLoading(true);
    try {
      const next = await readHomeStatus();
      setData(next);
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Home status unavailable');
    } finally {
      hasFetchedRef.current = true;
      if (isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let initialTimer: number | null = null;
    let pollTimer: number | null = null;

    const startPolling = () => {
      void refresh();
      pollTimer = window.setInterval(() => {
        void refresh();
      }, pollIntervalMs);
    };

    if (initialDelayMs > 0 && !hasFetchedRef.current) {
      initialTimer = window.setTimeout(startPolling, initialDelayMs);
    } else {
      startPolling();
    }

    return () => {
      if (initialTimer) window.clearTimeout(initialTimer);
      if (pollTimer) window.clearInterval(pollTimer);
    };
  }, [initialDelayMs, pollIntervalMs, refresh]);

  return {
    data,
    error,
    loading,
    refresh,
  };
}
