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
};

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

export function useHomeDashboardData({
  projects,
  processingSessions,
  unreadSessionIds,
}: UseHomeDashboardDataArgs) {
  const [alwaysOnEvents, setAlwaysOnEvents] = useState<AlwaysOnDashboardEvent[]>([]);
  const [alwaysOnError, setAlwaysOnError] = useState<string | null>(null);

  const refreshAlwaysOnEvents = useCallback(async () => {
    try {
      const response = await api.alwaysOnDashboardEvents(80);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as AlwaysOnDashboardEventsResponse;
      setAlwaysOnEvents(Array.isArray(payload.events) ? payload.events : []);
      setAlwaysOnError(null);
    } catch (error) {
      setAlwaysOnError(error instanceof Error ? error.message : 'Always-On events unavailable');
    }
  }, []);

  useEffect(() => {
    void refreshAlwaysOnEvents();
    const timer = window.setInterval(() => {
      void refreshAlwaysOnEvents();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [refreshAlwaysOnEvents]);

  return useMemo(() => {
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

    const taskStats: HomeTaskStats = {
      completed: completedAlwaysOn.length,
      running: alwaysOnRunning + processingCount,
      failed: failedAlwaysOn.length,
      total: completedAlwaysOn.length + failedAlwaysOn.length + alwaysOnRunning + processingCount,
      alwaysOnRunning,
    };

    const alerts: HomeAlertItem[] = [
      ...failedAlwaysOn.slice(0, 3).map((event) => ({
        id: event.eventId,
        title: `${event.projectDisplayName || event.projectName} 任务失败`,
        description: event.error?.message || event.title || 'Always-On 运行失败',
        duration: formatRelativeTime(Date.parse(event.timestamp)),
      })),
    ];

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

    const activities = [...chatActivities, ...alwaysOnActivities]
      .filter((item) => Number.isFinite(item.timestamp) && item.timestamp > 0)
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, 8);

    const recentProjects = [...projects]
      .sort((left, right) => Math.max(asTimestamp(right.lastActivity), asTimestamp(right.updated_at)) - Math.max(asTimestamp(left.lastActivity), asTimestamp(left.updated_at)))
      .slice(0, 7);

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
    };
  }, [
    alwaysOnError,
    alwaysOnEvents,
    processingSessions,
    projects,
    refreshAlwaysOnEvents,
    unreadSessionIds,
  ]);
}

export { formatRelativeTime as formatHomeRelativeTime };
