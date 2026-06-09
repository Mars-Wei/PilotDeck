import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getAllMCPServers } from '../utils/mcp-detector.js';
import { getMemorySchedulerStatus, getRecentMemoryActivityEvents } from '../services/memoryService.js';
import { getProjects, getProjectCronJobsOverview } from '../projects.js';
import { getPilotDeckGateway, getRouterDashboardData } from '../pilotdeck-bridge.js';
import { getAlwaysOnDashboardEvents } from '../services/always-on-events.js';

const router = express.Router();

const ACTIVE_PHASES = new Set([
  'discovery_started',
  'workspace_ready',
  'execution_started',
  'cron_started',
]);

const COMPLETED_PHASES = new Set([
  'execution_completed',
  'run_completed',
  'cron_completed',
]);

const FAILED_PHASES = new Set([
  'run_failed',
  'cron_failed',
]);

const TERMINAL_PHASES = new Set([
  'no_plan',
  'execution_completed',
  'run_completed',
  'run_failed',
  'cron_completed',
  'cron_failed',
]);

function countMcpServers(payload) {
  const globalServers = payload?.servers && typeof payload.servers === 'object'
    ? Object.keys(payload.servers).length
    : 0;
  const projectServers = payload?.projectServers && typeof payload.projectServers === 'object'
    ? Object.values(payload.projectServers).reduce((count, projectConfig) => {
        if (!projectConfig || typeof projectConfig !== 'object') return count;
        const servers = projectConfig.mcpServers && typeof projectConfig.mcpServers === 'object'
          ? Object.keys(projectConfig.mcpServers).length
          : 0;
        return count + servers;
      }, 0)
    : 0;

  return {
    global: globalServers,
    project: projectServers,
    total: globalServers + projectServers,
  };
}

async function checkGatewayHealth() {
  const startedAt = Date.now();
  try {
    const gateway = await getPilotDeckGateway();
    await gateway.listProjects();
    return {
      status: 'online',
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      status: 'offline',
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseLimit(value, fallback = 20, max = 80) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function asTimestamp(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function sessionTimestamp(session) {
  return Math.max(
    asTimestamp(session?.lastActivity),
    asTimestamp(session?.updated_at),
    asTimestamp(session?.createdAt),
    asTimestamp(session?.created_at),
  );
}

function sessionTitle(session) {
  return session?.customTitle || session?.aiTitle || session?.summary || session?.title || session?.name || '未命名会话';
}

function flattenProjectSessions(projects) {
  return projects.flatMap((project) =>
    (project.sessions || []).map((session) => ({
      project,
      session,
      timestamp: sessionTimestamp(session),
    })),
  );
}

function formatRelativeTime(timestamp) {
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

function countActiveAlwaysOnRuns(events) {
  const terminalRunIds = new Set(
    events
      .filter((event) => TERMINAL_PHASES.has(event.phase))
      .map((event) => event.runId)
      .filter(Boolean),
  );
  const activeRunIds = new Set();
  for (const event of events) {
    if (event.runId && ACTIVE_PHASES.has(event.phase) && !terminalRunIds.has(event.runId)) {
      activeRunIds.add(event.runId);
    }
  }
  return activeRunIds.size;
}

function buildTaskStats(alwaysOnEvents, cronJobs) {
  const cronCompleted = cronJobs.filter((job) => job.latestRun?.status === 'completed' || job.status === 'completed').length;
  const cronFailed = cronJobs.filter((job) => job.latestRun?.status === 'failed' || job.status === 'failed').length;
  const cronRunning = cronJobs.filter((job) => job.status === 'running').length;
  const alwaysOnCompleted = alwaysOnEvents.filter((event) => COMPLETED_PHASES.has(event.phase)).length;
  const alwaysOnFailed = alwaysOnEvents.filter((event) => FAILED_PHASES.has(event.phase)).length;
  const alwaysOnRunning = countActiveAlwaysOnRuns(alwaysOnEvents);
  const completed = alwaysOnCompleted + cronCompleted;
  const running = alwaysOnRunning + cronRunning;
  const failed = alwaysOnFailed + cronFailed;

  return {
    completed,
    running,
    failed,
    total: completed + running + failed,
    alwaysOnRunning,
  };
}

function emptyTaskStats() {
  return {
    completed: 0,
    running: 0,
    failed: 0,
    total: 0,
    alwaysOnRunning: 0,
  };
}

function addTaskStats(target, source) {
  target.completed += source.completed || 0;
  target.running += source.running || 0;
  target.failed += source.failed || 0;
  target.total += source.total || 0;
  target.alwaysOnRunning += source.alwaysOnRunning || 0;
  return target;
}

function flattenTaskMasterTasks(tasksData) {
  let roots = [];
  if (Array.isArray(tasksData)) {
    roots = tasksData;
  } else if (Array.isArray(tasksData?.tasks)) {
    roots = tasksData.tasks;
  } else if (tasksData && typeof tasksData === 'object') {
    for (const tagData of Object.values(tasksData)) {
      if (Array.isArray(tagData?.tasks)) {
        roots = roots.concat(tagData.tasks);
      }
    }
  }

  const tasks = [];
  const walk = (items) => {
    for (const item of items || []) {
      if (!item || typeof item !== 'object') continue;
      tasks.push(item);
      if (Array.isArray(item.subtasks)) {
        walk(item.subtasks);
      }
    }
  };
  walk(roots);
  return tasks;
}

async function readTaskMasterStats(projects) {
  const stats = emptyTaskStats();
  const warnings = [];

  await Promise.all(
    projects
      .filter((project) => project?.taskmaster?.hasTasksJson && project.fullPath)
      .map(async (project) => {
        const tasksPath = path.join(project.fullPath, '.taskmaster', 'tasks', 'tasks.json');
        try {
          const raw = await fs.readFile(tasksPath, 'utf8');
          const tasks = flattenTaskMasterTasks(JSON.parse(raw));
          for (const task of tasks) {
            const status = String(task.status || 'pending');
            stats.total += 1;
            if (status === 'done' || status === 'completed') {
              stats.completed += 1;
            } else if (status === 'in-progress' || status === 'review') {
              stats.running += 1;
            } else if (status === 'blocked' || status === 'failed') {
              stats.failed += 1;
            }
          }
        } catch (error) {
          warnings.push(`taskmaster:${project.name || project.fullPath}: ${error?.message || error}`);
        }
      }),
  );

  return { stats, warnings };
}

function buildAlerts(alwaysOnEvents, cronJobs) {
  const failedAlwaysOn = alwaysOnEvents
    .filter((event) => FAILED_PHASES.has(event.phase))
    .slice(0, 3)
    .map((event) => ({
      id: `always-on:${event.eventId || event.runId}`,
      type: 'error',
      title: `${event.projectDisplayName || event.projectName || '项目'} 任务失败`,
      description: event.error?.message || event.title || 'Always-On 运行失败',
      duration: formatRelativeTime(asTimestamp(event.timestamp)),
      sessionId: event.sessionId,
    }));

  const failedCron = cronJobs
    .filter((job) => job.latestRun?.status === 'failed' || job.status === 'failed')
    .slice(0, Math.max(0, 3 - failedAlwaysOn.length))
    .map((job) => ({
      id: `cron:${job.id}`,
      type: 'error',
      title: '定时任务失败',
      description: job.prompt || job.id,
      duration: job.lastFiredAt ? formatRelativeTime(job.lastFiredAt) : undefined,
      sessionId: job.latestRun?.sessionId,
    }));

  return [...failedAlwaysOn, ...failedCron];
}

function makeCostWindow() {
  return {
    amount: 0,
    saved: 0,
    baseline: 0,
    requestCount: 0,
  };
}

function addCostEntry(target, entry) {
  const actualCost = typeof entry?.cost === 'number' && Number.isFinite(entry.cost) ? entry.cost : 0;
  const baselineCost = typeof entry?.baselineCost === 'number' && Number.isFinite(entry.baselineCost)
    ? entry.baselineCost
    : actualCost;
  const savedCost = typeof entry?.savedCost === 'number' && Number.isFinite(entry.savedCost)
    ? entry.savedCost
    : baselineCost - actualCost;

  target.amount += actualCost;
  target.baseline += baselineCost;
  target.saved += savedCost;
  target.requestCount += 1;
}

function getWeekStartMs(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start.getTime();
}

function buildCostSummary(routingData) {
  const recent = routingData?.overall?.total || {};
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();
  const weekStartMs = getWeekStartMs(todayStart);
  const today = makeCostWindow();
  const week = makeCostWindow();

  for (const project of routingData?.projects || []) {
    for (const session of project.sessions || []) {
      for (const entry of session.routing?.requestLog || []) {
        const timestamp = asTimestamp(entry?.ts);
        if (!timestamp) continue;
        if (timestamp >= weekStartMs) addCostEntry(week, entry);
        if (timestamp >= todayStartMs) addCostEntry(today, entry);
      }
    }
  }

  return {
    recentAmount: recent.estimatedCost || 0,
    recentSaved: recent.savedCost || 0,
    baselineCost: recent.baselineCost || 0,
    requestCount: recent.requestCount || 0,
    todayAmount: today.amount,
    todaySaved: today.saved,
    todayBaselineCost: today.baseline,
    todayRequestCount: today.requestCount,
    weekTotal: week.amount,
    weekSaved: week.saved,
    weekBaselineCost: week.baseline,
    weekRequestCount: week.requestCount,
    hasTodayWindow: true,
  };
}

function buildActivityEvents(projects, alwaysOnEvents, routingData, memoryEvents, limit) {
  const chatActivities = flattenProjectSessions(projects)
    .filter((item) => item.timestamp > 0)
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, Math.max(6, limit))
    .map((item) => ({
      id: `chat:${item.session.id}`,
      type: 'chat',
      projectName: item.project.name,
      projectDisplayName: item.project.displayName,
      title: `继续了「${sessionTitle(item.session)}」`,
      detail: formatRelativeTime(item.timestamp),
      timestamp: item.timestamp,
    }));

  const alwaysOnActivities = alwaysOnEvents
    .map((event) => {
      const timestamp = asTimestamp(event.timestamp);
      return {
        id: `always-on:${event.eventId || event.runId || timestamp}`,
        type: event.phase?.includes('completed') || event.phase?.includes('failed') ? 'task' : 'memory',
        projectName: event.projectName,
        projectDisplayName: event.projectDisplayName,
        title: event.title || String(event.phase || 'always-on').replace(/_/g, ' '),
        detail: formatRelativeTime(timestamp),
        timestamp,
      };
    });

  const cost = routingData?.overall?.total;
  const costActivity = cost && cost.requestCount > 0
    ? [{
        id: 'cost:recent-routing',
        type: 'cost',
        projectName: 'general',
        projectDisplayName: '路由系统',
        title: cost.savedCost > 0
          ? `智能路由已节省 $${cost.savedCost.toFixed(2)}`
          : '智能路由已更新成本统计',
        detail: `${cost.requestCount} 次请求`,
        timestamp: Date.now(),
      }]
    : [];

  return [...costActivity, ...memoryEvents, ...chatActivities, ...alwaysOnActivities]
    .filter((event) => Number.isFinite(event.timestamp) && event.timestamp > 0)
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, limit);
}

router.get('/status', async (_req, res) => {
  const timestamp = new Date().toISOString();

  const [gatewayResult, mcpResult, memoryResult] = await Promise.allSettled([
    checkGatewayHealth(),
    getAllMCPServers(),
    Promise.resolve(getMemorySchedulerStatus()),
  ]);

  const gatewayPayload = gatewayResult.status === 'fulfilled'
    ? gatewayResult.value
    : {
        status: 'offline',
        error: gatewayResult.reason instanceof Error ? gatewayResult.reason.message : String(gatewayResult.reason),
      };

  const mcpPayload = mcpResult.status === 'fulfilled' ? mcpResult.value : null;
  const mcpCounts = countMcpServers(mcpPayload);
  const mcpError = mcpResult.status === 'rejected'
    ? (mcpResult.reason instanceof Error ? mcpResult.reason.message : String(mcpResult.reason))
    : mcpPayload?.error;

  const memoryPayload = memoryResult.status === 'fulfilled' ? memoryResult.value : null;
  const memoryError = memoryResult.status === 'rejected'
    ? (memoryResult.reason instanceof Error ? memoryResult.reason.message : String(memoryResult.reason))
    : memoryPayload?.configError;

  res.json({
    timestamp,
    gateway: {
      status: gatewayPayload.status,
      checkedAt: timestamp,
      latencyMs: gatewayPayload.latencyMs,
      ...(gatewayPayload.error ? { error: gatewayPayload.error } : {}),
    },
    mcp: {
      status: mcpError ? 'degraded' : 'online',
      connected: mcpCounts.total,
      total: mcpCounts.total,
      global: mcpCounts.global,
      project: mcpCounts.project,
      hasConfig: Boolean(mcpPayload?.hasConfig),
      ...(mcpError ? { error: mcpError } : {}),
    },
    memory: {
      status: memoryError ? 'degraded' : memoryPayload?.enabled === false ? 'offline' : 'online',
      scheduler: {
        enabled: Boolean(memoryPayload?.enabled),
        running: Boolean(memoryPayload?.running),
        intervalMs: memoryPayload?.intervalMs ?? null,
      },
      ...(memoryError ? { error: memoryError } : {}),
    },
  });
});

router.get('/activity', async (req, res) => {
  const limit = parseLimit(req.query?.limit, 20, 80);
  try {
    const [projectsResult, alwaysOnResult, routingResult, memoryResult] = await Promise.allSettled([
      getProjects(),
      getAlwaysOnDashboardEvents({ limit: Math.max(limit, 40) }),
      Promise.resolve(getRouterDashboardData()),
      getRecentMemoryActivityEvents(Math.max(8, Math.min(limit, 20))),
    ]);

    const projects = projectsResult.status === 'fulfilled' && Array.isArray(projectsResult.value)
      ? projectsResult.value
      : [];
    const alwaysOnEvents = alwaysOnResult.status === 'fulfilled' && Array.isArray(alwaysOnResult.value?.events)
      ? alwaysOnResult.value.events
      : [];
    const routingData = routingResult.status === 'fulfilled' ? routingResult.value : null;
    const memoryEvents = memoryResult.status === 'fulfilled' && Array.isArray(memoryResult.value)
      ? memoryResult.value
      : [];
    const errors = [
      projectsResult.status === 'rejected' ? `projects: ${projectsResult.reason?.message || projectsResult.reason}` : null,
      alwaysOnResult.status === 'rejected' ? `always-on: ${alwaysOnResult.reason?.message || alwaysOnResult.reason}` : null,
      routingResult.status === 'rejected' ? `routing: ${routingResult.reason?.message || routingResult.reason}` : null,
      memoryResult.status === 'rejected' ? `memory: ${memoryResult.reason?.message || memoryResult.reason}` : null,
    ].filter(Boolean);

    res.json({
      generatedAt: new Date().toISOString(),
      events: buildActivityEvents(projects, alwaysOnEvents, routingData, memoryEvents, limit),
      ...(errors.length ? { warnings: errors } : {}),
    });
  } catch (error) {
    console.error('[home-activity] failed:', error);
    res.status(500).json({ error: error?.message || 'home activity failed' });
  }
});

router.get('/summary', async (_req, res) => {
  try {
    const [projectsResult, alwaysOnResult, cronResult, routingResult] = await Promise.allSettled([
      getProjects(),
      getAlwaysOnDashboardEvents({ limit: 120 }),
      getProjectCronJobsOverview(),
      Promise.resolve(getRouterDashboardData()),
    ]);

    const projects = projectsResult.status === 'fulfilled' && Array.isArray(projectsResult.value)
      ? projectsResult.value
      : [];
    const alwaysOnEvents = alwaysOnResult.status === 'fulfilled' && Array.isArray(alwaysOnResult.value?.events)
      ? alwaysOnResult.value.events
      : [];
    const cronJobs = cronResult.status === 'fulfilled' && Array.isArray(cronResult.value?.jobs)
      ? cronResult.value.jobs
      : [];
    const routingData = routingResult.status === 'fulfilled' ? routingResult.value : null;
    const taskMasterResult = await readTaskMasterStats(projects);
    const errors = [
      projectsResult.status === 'rejected' ? `projects: ${projectsResult.reason?.message || projectsResult.reason}` : null,
      alwaysOnResult.status === 'rejected' ? `always-on: ${alwaysOnResult.reason?.message || alwaysOnResult.reason}` : null,
      cronResult.status === 'rejected' ? `cron: ${cronResult.reason?.message || cronResult.reason}` : null,
      routingResult.status === 'rejected' ? `routing: ${routingResult.reason?.message || routingResult.reason}` : null,
      ...taskMasterResult.warnings,
    ].filter(Boolean);

    const taskStats = addTaskStats(buildTaskStats(alwaysOnEvents, cronJobs), taskMasterResult.stats);

    res.json({
      generatedAt: new Date().toISOString(),
      cost: buildCostSummary(routingData),
      tasks: taskStats,
      messages: {
        unread: 0,
        unreadSessions: 0,
        mentions: 0,
      },
      alerts: buildAlerts(alwaysOnEvents, cronJobs),
      ...(errors.length ? { warnings: errors } : {}),
    });
  } catch (error) {
    console.error('[home-summary] failed:', error);
    res.status(500).json({ error: error?.message || 'home summary failed' });
  }
});

export default router;
