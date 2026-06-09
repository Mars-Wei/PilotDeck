import { useState, useEffect, useCallback, useRef } from 'react';
import { authenticatedFetch } from '../utils/api';
import type { TokenBucket } from './useRouterSettings';

export type RequestLogEntry = {
  ts: number;
  role: 'main' | 'sub';
  tier?: string;
  model: string;
  tokens: number;
  cost: number;
  baselineCost?: number;
  savedCost?: number;
  query?: string;
  isSubagentDispatch?: boolean;
  subRequestCount?: number;
};

export type SessionRouting = {
  total: TokenBucket;
  byTier: Record<string, TokenBucket>;
  byScenario: Record<string, TokenBucket>;
  byRole: Record<string, TokenBucket>;
  byModel: Record<string, TokenBucket>;
  requestLog?: RequestLogEntry[];
  firstSeenAt: number;
  lastActiveAt: number;
};

export type DashboardSession = {
  sessionId: string;
  title: string;
  provider: string;
  lastActivity: string | null;
  userQueries?: string[];
  routing: SessionRouting | null;
};

export type ProjectAggregated = {
  total: TokenBucket;
  byTier: Record<string, TokenBucket>;
  byRole: Record<string, TokenBucket>;
  sessionCount: number;
  routedSessionCount: number;
};

export type DashboardProject = {
  name: string;
  displayName: string;
  fullPath: string;
  sessions: DashboardSession[];
  aggregated: ProjectAggregated;
};

export type DashboardOverall = {
  total: TokenBucket;
  byTier: Record<string, TokenBucket>;
  byRole: Record<string, TokenBucket>;
  projectCount: number;
  sessionCount: number;
};

export type DashboardData = {
  projects: DashboardProject[];
  overall: DashboardOverall;
  unmatchedSessions: Array<{
    sessionId: string;
    total: TokenBucket;
    byScenario: Record<string, TokenBucket>;
    byTier: Record<string, TokenBucket>;
    byRole: Record<string, TokenBucket>;
    byModel: Record<string, TokenBucket>;
    firstSeenAt: number;
    lastActiveAt: number;
  }>;
};

const POLL_INTERVAL_MS = 30_000;

type UseRoutingDashboardOptions = {
  enabled?: boolean;
  initialDelayMs?: number;
};

export function useRoutingDashboard({
  enabled = true,
  initialDelayMs = 0,
}: UseRoutingDashboardOptions = {}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasFetchedRef = useRef(false);

  const refresh = useCallback(async () => {
    const isInitial = !hasFetchedRef.current;
    if (isInitial) setLoading(true);
    try {
      const res = await authenticatedFetch('/api/ccr/dashboard');
      if (res.ok) {
        setData(await res.json());
        setError(null);
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
      }
    } catch (err: any) {
      setError(err.message || '加载路由仪表盘失败');
    } finally {
      hasFetchedRef.current = true;
      if (isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (!hasFetchedRef.current) setLoading(false);
      return undefined;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      refresh();
      interval = setInterval(refresh, POLL_INTERVAL_MS);
    };

    if (initialDelayMs > 0 && !hasFetchedRef.current) {
      timer = setTimeout(startPolling, initialDelayMs);
    } else {
      startPolling();
    }

    return () => {
      if (timer) clearTimeout(timer);
      if (interval) clearInterval(interval);
    };
  }, [enabled, initialDelayMs, refresh]);

  return { data, loading, error, refresh };
}
