import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AlwaysOnDashboardEvent,
  AlwaysOnDashboardEventsResponse,
  Project,
  ProjectSession,
} from '../types/app';
import { api } from '../utils/api';
import { projectDisplayName, sessionDisplayTitle } from '../lib/customNames';

export type HomeTaskStats = {
  completed: number;
  running: number;
  failed: number;
  total: number;
  alwaysOnRunning: number;
};

export type HomeAlertItem = {
  id: string;
  title: string;
  description: string;
  duration?: string;
  sessionId?: string;
};

export type HomeActivityEvent = {
  id: string;
  type: 'chat' | 'task' | 'cost' | 'memory';
  projectName: string;
  projectDisplayName?: string;
  title: string;
  detail: string;
  timestamp: number;
};

export type HomeCostSummary = {
  recentAmount: number;
  recentSaved: number;
  baselineCost: number;
  requestCount: number;
  todayAmount: number;
  todaySaved: number;
  todayRequestCount: number;
  weekTotal: number;
  weekSaved: number;
  weekRequestCount: number;
  hasTodayWindow: boolean;
};

export type HomeSessionCard = {
  project: Project;
  session: ProjectSession;
  status: 'running' | 'unread' | 'recent';
  lastActivityMs: number;
};

type UseHomeDashboardDataArgs = {
  projects: Project[];
  processingSessions: Set<string>;
  unreadSessionIds: Set<string>;
  initialDelayMs?: number;
};

type HomeSummaryResponse = {
  cost?: Partial<HomeCostSummary>;
  tasks?: Partial<HomeTaskStats>;
  alerts?: HomeAlertItem[];
  warnings?: string[];
};

type HomeActivityResponse = {
  events?: HomeActivityEvent[];
  warnings?: string[];
};

export type HomeDashboardData = ReturnType<typeof buildHomeDashboardData>;

const ACTIVE_PHASES = new Set([
  'discovery_started',
  'workspace_ready',
  'execution_started',
  'cron_started',
]);

const TERMINAL_PHASES = new Set([
  'no_plan',
  'execution_completed',
  'run_completed',
  'run_failed',
  'cron_completed',
  'cron_failed',
]);

function asTimestamp(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getSessionTime(session: ProjectSession): number {
  return Math.max(
    asTimestamp(session.lastActivity),
    asTimestamp(session.updated_at),
    asTimestamp(session.createdAt),
    asTimestamp(session.created_at),
  );
}

function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return '未知时间';
  const diffMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function flattenSessions(projects: Project[]): HomeSessionCard[] {
  return projects.flatMap((project) =>
    (project.sessions ?? []).map((session) => ({
      project,
      session,
      status: 'recent' as const,
      lastActivityMs: getSessionTime(session),
    })),
  );
}

function countActiveAlwaysOnRuns(events: AlwaysOnDashboardEvent[]): number {
  const terminalRunIds = new Set(
    events
      .filter((event) => TERMINAL_PHASES.has(event.phase))
      .map((event) => event.runId),
  );
  const activeRunIds = new Set<string>();
  for (const event of events) {
    if (ACTIVE_PHASES.has(event.phase) && !terminalRunIds.has(event.runId)) {
      activeRunIds.add(event.runId);
    }
  }
  return activeRunIds.size;
}

function normalizeActivityEvents(events: HomeActivityResponse['events']): HomeActivityEvent[] | null {
  if (!Array.isArray(events)) return null;
  return events
    .map((event) => {
      const timestamp = asTimestamp(event.timestamp);
      const type: HomeActivityEvent['type'] = event.type === 'task' || event.type === 'cost' || event.type === 'memory'
        ? event.type
        : 'chat';
      return {
        id: String(event.id || `${type}:${timestamp}`),
        type,
        projectName: String(event.projectName || 'general'),
        projectDisplayName: event.projectDisplayName ? String(event.projectDisplayName) : undefined,
        title: String(event.title || '近期动态'),
        detail: String(event.detail || formatRelativeTime(timestamp)),
        timestamp,
      };
    })
    .filter((event) => event.timestamp > 0);
}

function normalizeAlerts(alerts: HomeSummaryResponse['alerts']): HomeAlertItem[] | null {
  if (!Array.isArray(alerts)) return null;
  return alerts.map((alert, index) => ({
    id: String(alert.id || `alert:${index}`),
    title: String(alert.title || '需要关注'),
    description: String(alert.description || ''),
    duration: alert.duration ? String(alert.duration) : undefined,
    sessionId: alert.sessionId ? String(alert.sessionId) : undefined,
  }));
}

async function readHomeSummary(): Promise<HomeSummaryResponse> {
  const response = await api.homeSummary();
  if (!response.ok) {
    throw new Error(`summary HTTP ${response.status}`);
  }
  return await response.json() as HomeSummaryResponse;
}

async function readHomeActivity(): Promise<HomeActivityResponse> {
  const response = await api.homeActivity(20);
  if (!response.ok) {
    throw new Error(`activity HTTP ${response.status}`);
  }
  return await response.json() as HomeActivityResponse;
}

async function readAlwaysOnEventsFallback(): Promise<AlwaysOnDashboardEvent[]> {
  const response = await api.alwaysOnDashboardEvents(80);
  if (!response.ok) {
    throw new Error(`always-on HTTP ${response.status}`);
  }
  const payload = (await response.json()) as AlwaysOnDashboardEventsResponse;
  return Array.isArray(payload.events) ? payload.events : [];
}

function buildHomeDashboardData({
  projects,
  processingSessions,
  unreadSessionIds,
  alwaysOnEvents,
  alwaysOnError,
  refreshAlwaysOnEvents,
  homeSummary,
  homeActivity,
}: UseHomeDashboardDataArgs & {
  alwaysOnEvents: AlwaysOnDashboardEvent[];
  alwaysOnError: string | null;
  refreshAlwaysOnEvents: () => Promise<void>;
  homeSummary: HomeSummaryResponse | null;
  homeActivity: HomeActivityResponse | null;
}) {
  const allSessions = flattenSessions(projects).sort((left, right) => right.lastActivityMs - left.lastActivityMs);
  const activeSessions = allSessions
    .map((item) => ({
      ...item,
      status: processingSessions.has(item.session.id)
        ? ('running' as const)
        : unreadSessionIds.has(item.session.id)
          ? ('unread' as const)
          : ('recent' as const),
    }))
    .filter((item) => item.status !== 'recent')
    .concat(allSessions.filter((item) => !processingSessions.has(item.session.id) && !unreadSessionIds.has(item.session.id)))
    .slice(0, 6);

  const unreadSessions = allSessions.filter((item) => unreadSessionIds.has(item.session.id));
  const failedAlwaysOn = alwaysOnEvents.filter((event) => event.phase === 'run_failed' || event.phase === 'cron_failed');
  const completedAlwaysOn = alwaysOnEvents.filter((event) => event.phase === 'run_completed' || event.phase === 'cron_completed');
  const alwaysOnRunning = countActiveAlwaysOnRuns(alwaysOnEvents);
  const processingCount = processingSessions.size;

  const fallbackTaskStats: HomeTaskStats = {
    completed: completedAlwaysOn.length,
    running: alwaysOnRunning + processingCount,
    failed: failedAlwaysOn.length,
    total: completedAlwaysOn.length + failedAlwaysOn.length + alwaysOnRunning + processingCount,
    alwaysOnRunning,
  };

  const summaryTasks = homeSummary?.tasks;
  const backendRunning = asNumber(summaryTasks?.running, alwaysOnRunning);
  const backendCompleted = asNumber(summaryTasks?.completed, fallbackTaskStats.completed);
  const backendFailed = asNumber(summaryTasks?.failed, fallbackTaskStats.failed);
  const taskStats: HomeTaskStats = summaryTasks
    ? {
        completed: backendCompleted,
        running: backendRunning + processingCount,
        failed: backendFailed,
        total: asNumber(summaryTasks.total, backendCompleted + backendRunning + backendFailed) + processingCount,
        alwaysOnRunning: asNumber(summaryTasks.alwaysOnRunning, alwaysOnRunning),
      }
    : fallbackTaskStats;

  const fallbackAlerts: HomeAlertItem[] = [
    ...failedAlwaysOn.slice(0, 3).map((event) => ({
      id: event.eventId,
      title: `${event.projectDisplayName || event.projectName} 任务失败`,
      description: event.error?.message || event.title || 'Always-On 运行失败',
      duration: formatRelativeTime(Date.parse(event.timestamp)),
    })),
  ];
  const alerts = normalizeAlerts(homeSummary?.alerts) ?? fallbackAlerts;

  const chatActivities: HomeActivityEvent[] = allSessions.slice(0, 5).map((item) => ({
    id: `chat:${item.session.id}`,
    type: 'chat',
    projectName: item.project.name,
    projectDisplayName: projectDisplayName(item.project),
    title: `继续了「${sessionDisplayTitle(item.session)}」`,
    detail: formatRelativeTime(item.lastActivityMs),
    timestamp: item.lastActivityMs,
  }));

  const alwaysOnActivities: HomeActivityEvent[] = alwaysOnEvents.slice(0, 8).map((event) => ({
    id: `always-on:${event.eventId}`,
    type: event.phase.includes('completed') || event.phase.includes('failed') ? 'task' : 'memory',
    projectName: event.projectName,
    projectDisplayName: event.projectDisplayName,
    title: event.title || event.phase.replace(/_/g, ' '),
    detail: formatRelativeTime(Date.parse(event.timestamp)),
    timestamp: Date.parse(event.timestamp),
  }));

  const fallbackActivities = [...chatActivities, ...alwaysOnActivities]
    .filter((item) => Number.isFinite(item.timestamp) && item.timestamp > 0)
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, 8);
  const activities = normalizeActivityEvents(homeActivity?.events) ?? fallbackActivities;

  const recentProjects = [...projects]
    .sort((left, right) => Math.max(asTimestamp(right.lastActivity), asTimestamp(right.updated_at)) - Math.max(asTimestamp(left.lastActivity), asTimestamp(left.updated_at)))
    .slice(0, 7);

  const cost: HomeCostSummary = {
    recentAmount: asNumber(homeSummary?.cost?.recentAmount),
    recentSaved: asNumber(homeSummary?.cost?.recentSaved),
    baselineCost: asNumber(homeSummary?.cost?.baselineCost),
    requestCount: asNumber(homeSummary?.cost?.requestCount),
    todayAmount: asNumber(homeSummary?.cost?.todayAmount),
    todaySaved: asNumber(homeSummary?.cost?.todaySaved),
    todayRequestCount: asNumber(homeSummary?.cost?.todayRequestCount),
    weekTotal: asNumber(homeSummary?.cost?.weekTotal),
    weekSaved: asNumber(homeSummary?.cost?.weekSaved),
    weekRequestCount: asNumber(homeSummary?.cost?.weekRequestCount),
    hasTodayWindow: Boolean(homeSummary?.cost?.hasTodayWindow),
  };

  return {
    activeSessions,
    unreadSessions,
    unreadCount: unreadSessionIds.size,
    taskStats,
    alerts,
    activities,
    recentProjects,
    alwaysOnEvents,
    alwaysOnError,
    refreshAlwaysOnEvents,
    cost,
  };
}

export function useHomeDashboardData({
  projects,
  processingSessions,
  unreadSessionIds,
  initialDelayMs = 0,
}: UseHomeDashboardDataArgs) {
  const [alwaysOnEvents, setAlwaysOnEvents] = useState<AlwaysOnDashboardEvent[]>([]);
  const [alwaysOnError, setAlwaysOnError] = useState<string | null>(null);
  const [homeSummary, setHomeSummary] = useState<HomeSummaryResponse | null>(null);
  const [homeActivity, setHomeActivity] = useState<HomeActivityResponse | null>(null);

  const refreshHomeData = useCallback(async () => {
    const [summaryResult, activityResult] = await Promise.allSettled([
      readHomeSummary(),
      readHomeActivity(),
    ]);

    const errors: string[] = [];
    if (summaryResult.status === 'fulfilled') {
      setHomeSummary(summaryResult.value);
    } else {
      setHomeSummary(null);
      errors.push(summaryResult.reason instanceof Error ? summaryResult.reason.message : 'summary unavailable');
    }

    if (activityResult.status === 'fulfilled') {
      setHomeActivity(activityResult.value);
    } else {
      setHomeActivity(null);
      errors.push(activityResult.reason instanceof Error ? activityResult.reason.message : 'activity unavailable');
    }

    if (errors.length > 0) {
      try {
        setAlwaysOnEvents(await readAlwaysOnEventsFallback());
      } catch (fallbackError) {
        errors.push(fallbackError instanceof Error ? fallbackError.message : 'Always-On fallback unavailable');
      }
    } else {
      setAlwaysOnEvents([]);
    }

    setAlwaysOnError(errors.length > 0 ? errors.join(' · ') : null);
  }, []);

  useEffect(() => {
    let initialTimer: number | null = null;
    let pollTimer: number | null = null;

    const startPolling = () => {
      void refreshHomeData();
      pollTimer = window.setInterval(() => {
        void refreshHomeData();
      }, 30_000);
    };

    if (initialDelayMs > 0) {
      initialTimer = window.setTimeout(startPolling, initialDelayMs);
    } else {
      startPolling();
    }

    return () => {
      if (initialTimer) window.clearTimeout(initialTimer);
      if (pollTimer) window.clearInterval(pollTimer);
    };
  }, [initialDelayMs, refreshHomeData]);

  return useMemo(() => buildHomeDashboardData({
    projects,
    processingSessions,
    unreadSessionIds,
    alwaysOnEvents,
    alwaysOnError,
    refreshAlwaysOnEvents: refreshHomeData,
    homeSummary,
    homeActivity,
  }), [
    alwaysOnError,
    alwaysOnEvents,
    homeActivity,
    homeSummary,
    processingSessions,
    projects,
    refreshHomeData,
    unreadSessionIds,
  ]);
}

export { formatRelativeTime as formatHomeRelativeTime };
