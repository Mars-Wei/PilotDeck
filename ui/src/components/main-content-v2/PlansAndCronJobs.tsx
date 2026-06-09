import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Archive,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileText,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type {
  CronJobOverview,
  CronJobsOverviewResponse,
  DiscoveryPlanOverview,
  DiscoveryPlanStatus,
  Project,
  ProjectDiscoveryPlansResponse,
  WorkCycleOverview,
} from '../../types/app';
import { api } from '../../utils/api';
import { cn } from '../../lib/utils.js';

const POLL_INTERVAL_MS = 15_000;

type CronFrequency = 'daily' | 'weekly' | 'monthly' | 'once';

type CronCreateForm = {
  title: string;
  prompt: string;
  frequency: CronFrequency;
  time: string;
  weekday: string;
  monthDay: string;
  runAt: string;
  projectName: string;
};

type CronTaskTemplate = {
  id: string;
  title: string;
  description: string;
  prompt: string;
  frequency: CronFrequency;
  time: string;
};

const EMPTY_CRON_FORM: CronCreateForm = {
  title: '',
  prompt: '',
  frequency: 'daily',
  time: '09:00',
  weekday: '1',
  monthDay: '1',
  runAt: '',
  projectName: '',
};

const CRON_TEMPLATES: CronTaskTemplate[] = [
  {
    id: 'ai-tech-daily',
    title: '每日 AI & 科技简报',
    description: '每天自动追踪全球 AI 与科技领域最新动态，精选 5 条最重要的新闻。',
    prompt: '请生成每日 AI 与科技简报，重点覆盖大模型、AI 产品、开源项目、芯片、机器人和重要公司动态。输出 5 条最重要的信息，每条包含摘要、影响判断和来源线索。',
    frequency: 'daily',
    time: '09:00',
  },
  {
    id: 'ai-product-weekly',
    title: 'AI产品动态周报',
    description: '每周自动汇总主流 AI 产品更新、媒体报道和用户口碑。',
    prompt: '请生成 AI 产品动态周报，覆盖豆包、通义千问、Kimi、智谱清言、Claude、ChatGPT、Gemini 等产品的功能更新、增长动作、媒体报道和用户反馈。',
    frequency: 'weekly',
    time: '09:00',
  },
  {
    id: 'market-daily',
    title: 'A股 & 港股行情日报',
    description: '每天收盘后复盘指数、热门板块和关键事件，适合投资者快速了解市场。',
    prompt: '请生成 A 股与港股行情日报，包含主要指数表现、热门板块、重要个股事件、资金面变化和明日观察重点。要求结构清晰，避免投资建议式表述。',
    frequency: 'daily',
    time: '15:30',
  },
  {
    id: 'social-topic-daily',
    title: '社媒热点选题日报',
    description: '每天扫描小红书、抖音、微博热门话题和爆款趋势，推荐 5 个选题。',
    prompt: '请生成社媒热点选题日报，扫描小红书、抖音、微博等平台的热门话题、内容趋势和爆款表达，推荐 5 个今天值得创作的选题，并给出角度建议。',
    frequency: 'daily',
    time: '09:00',
  },
  {
    id: 'github-weekly',
    title: 'GitHub 热门项目周报',
    description: '每周追踪 GitHub Star 增长最快的开源项目，聚焦 AI、开发工具和基础设施。',
    prompt: '请生成 GitHub 热门项目周报，聚焦 AI、开发工具、数据基础设施和效率工具。列出值得关注的新项目或快速增长项目，说明用途、亮点和适合关注的人群。',
    frequency: 'weekly',
    time: '09:00',
  },
  {
    id: 'funding-weekly',
    title: '一级市场融资周报',
    description: '每周汇总全球 VC/PE 重要融资事件，覆盖 AI、科技、消费和医疗方向。',
    prompt: '请生成一级市场融资周报，覆盖全球 VC/PE 重要融资事件，重点关注 AI、科技、消费和医疗。输出项目名称、赛道、金额、投资方、核心业务和趋势判断。',
    frequency: 'weekly',
    time: '09:00',
  },
];

const FREQUENCY_LABEL: Record<CronFrequency, string> = {
  daily: '每天',
  weekly: '每周一',
  monthly: '每月',
  once: '仅一次',
};

function buildCronExpression(form: CronCreateForm) {
  const [hourRaw = '9', minuteRaw = '0'] = form.time.split(':');
  const hour = Math.max(0, Math.min(23, Number.parseInt(hourRaw, 10) || 0));
  const minute = Math.max(0, Math.min(59, Number.parseInt(minuteRaw, 10) || 0));

  if (form.frequency === 'daily') {
    return `${minute} ${hour} * * *`;
  }

  if (form.frequency === 'weekly') {
    const weekday = Math.max(0, Math.min(6, Number.parseInt(form.weekday, 10) || 1));
    return `${minute} ${hour} * * ${weekday}`;
  }

  const day = Math.max(1, Math.min(28, Number.parseInt(form.monthDay, 10) || 1));
  return `${minute} ${hour} ${day} * *`;
}

function buildCronMessage(form: CronCreateForm) {
  const title = form.title.trim();
  const prompt = form.prompt.trim();
  return title ? `任务标题：${title}\n\n执行指令：\n${prompt}` : prompt;
}

async function readErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    return body.message || body.error || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

type PlanDisplayStatus =
  | 'created'
  | 'preparingWorkspace'
  | 'executing'
  | 'completedWaiting'
  | 'failed'
  | 'archived';

function mapPlanStatus(status: DiscoveryPlanStatus): PlanDisplayStatus {
  switch (status) {
    case 'ready':
      return 'created';
    case 'queued':
      return 'preparingWorkspace';
    case 'running':
      return 'executing';
    case 'completed':
      return 'completedWaiting';
    case 'failed':
      return 'failed';
    case 'archived':
      return 'archived';
    default:
      return 'created';
  }
}

const PLAN_STATUS_STYLE: Record<PlanDisplayStatus, string> = {
  created: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  preparingWorkspace: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  executing: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  completedWaiting: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  archived: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
};

const PLAN_STATUS_LABEL: Record<PlanDisplayStatus, { key: string; defaultValue: string }> = {
  created: { key: 'plansCron.status.created', defaultValue: '刚创建' },
  preparingWorkspace: { key: 'plansCron.status.preparingWorkspace', defaultValue: '正在创建隔离环境' },
  executing: { key: 'plansCron.status.executing', defaultValue: '正在执行' },
  completedWaiting: { key: 'plansCron.status.completedWaiting', defaultValue: '执行完成' },
  failed: { key: 'plansCron.status.failed', defaultValue: '执行失败' },
  archived: { key: 'plansCron.status.archived', defaultValue: '已归档' },
};

const CRON_STATUS_STYLE: Record<'scheduled' | 'running', string> = {
  scheduled: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  running: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
};

const CRON_STATUS_LABEL: Record<'scheduled' | 'running', { key: string; defaultValue: string }> = {
  scheduled: { key: 'plansCron.status.scheduled', defaultValue: '已安排' },
  running: { key: 'plansCron.status.running', defaultValue: '运行中' },
};

// ---------------------------------------------------------------------------
// Unified row type
// ---------------------------------------------------------------------------

type UnifiedItem =
  | { kind: 'plan'; data: DiscoveryPlanOverview; projectName: string; projectDisplayName: string; projectKey: string }
  | { kind: 'cron'; data: CronJobOverview; projectName: string; projectDisplayName: string; projectKey: string };

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

function formatAbsoluteTime(iso: string | number): string {
  const parsed = typeof iso === 'number' ? iso : Date.parse(iso);
  if (Number.isNaN(parsed)) return '';
  return new Date(parsed).toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// ---------------------------------------------------------------------------
// Column widths (shared between header and body for alignment)
// ---------------------------------------------------------------------------

const COL = {
  title: 'min-w-0 flex-1 max-w-[380px]',
  createdAt: 'w-[150px] shrink-0',
  status: 'w-[160px] shrink-0',
  actions: 'w-[140px] shrink-0',
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type PlansAndCronJobsProps = {
  onApplyWorkCycle?: (projectName: string, cycleId: string) => Promise<void>;
  onOpenPlanDetail?: (planId: string, projectName: string, projectDisplayName: string, sourceRunId: string, projectKey: string) => void;
};

export default function PlansAndCronJobs({ onApplyWorkCycle, onOpenPlanDetail }: PlansAndCronJobsProps) {
  const { t } = useTranslation('alwaysOn');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [plansByProject, setPlansByProject] = useState<Map<string, DiscoveryPlanOverview[]>>(new Map());
  const [cyclesByProject, setCyclesByProject] = useState<Map<string, WorkCycleOverview[]>>(new Map());
  const [cronJobs, setCronJobs] = useState<CronJobOverview[]>([]);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [cycleBusy, setCycleBusy] = useState<string | null>(null);
  const [confirmingArchiveCycle, setConfirmingArchiveCycle] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CronCreateForm>(EMPTY_CRON_FORM);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const toggleSection = (key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const openCreate = useCallback((template?: CronTaskTemplate) => {
    const defaultProjectName = projects[0]?.name || '';
    if (template) {
      setSelectedTemplateId(template.id);
      setCreateForm({
        ...EMPTY_CRON_FORM,
        title: template.title,
        prompt: template.prompt,
        frequency: template.frequency,
        time: template.time,
        projectName: defaultProjectName,
      });
    } else {
      setSelectedTemplateId(null);
      setCreateForm({
        ...EMPTY_CRON_FORM,
        projectName: defaultProjectName,
      });
    }
    setCreateError(null);
    setCreateSuccess(null);
    setShowAdvanced(false);
    setCreateOpen(true);
  }, [projects]);

  const closeCreate = useCallback(() => {
    if (creating) return;
    setCreateOpen(false);
    setCreateError(null);
    setCreateSuccess(null);
  }, [creating]);

  const updateCreateForm = useCallback(
    <K extends keyof CronCreateForm>(key: K, value: CronCreateForm[K]) => {
      setCreateForm((current) => ({ ...current, [key]: value }));
      setCreateError(null);
      setCreateSuccess(null);
    },
    [],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const projectsRes = await api.projects();
      if (!projectsRes.ok) throw new Error(`Projects: HTTP ${projectsRes.status}`);
      const projectsList: Project[] = await projectsRes.json();
      setProjects(projectsList);

      const [cronRes, ...mixedResults] = await Promise.all([
        api.allCronJobs(),
        ...projectsList.flatMap((p) => [
          api.projectDiscoveryPlans(p.name),
          api.projectWorkCycles(p.name),
        ]),
      ]);

      if (cronRes.ok) {
        const cronPayload = (await cronRes.json()) as CronJobsOverviewResponse;
        setCronJobs(Array.isArray(cronPayload.jobs) ? cronPayload.jobs : []);
      } else {
        setCronJobs([]);
      }

      const newPlansByProject = new Map<string, DiscoveryPlanOverview[]>();
      const newCyclesByProject = new Map<string, WorkCycleOverview[]>();
      for (let i = 0; i < projectsList.length; i++) {
        const planRes = mixedResults[i * 2];
        const cycleRes = mixedResults[i * 2 + 1];
        if (planRes && planRes.ok) {
          const payload = (await planRes.json()) as ProjectDiscoveryPlansResponse;
          if (Array.isArray(payload.plans) && payload.plans.length > 0) {
            newPlansByProject.set(projectsList[i]!.name, payload.plans);
          }
        }
        if (cycleRes && cycleRes.ok) {
          const payload = (await cycleRes.json()) as { cycles?: WorkCycleOverview[] };
          if (Array.isArray(payload.cycles) && payload.cycles.length > 0) {
            newCyclesByProject.set(projectsList[i]!.name, payload.cycles);
          }
        }
      }
      setPlansByProject(newPlansByProject);
      setCyclesByProject(newCyclesByProject);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCreateCron = useCallback(async () => {
    const title = createForm.title.trim();
    const prompt = createForm.prompt.trim();

    if (!title) {
      setCreateError('请输入任务标题。');
      return;
    }

    if (!prompt) {
      setCreateError('请输入执行指令。');
      return;
    }

    setCreating(true);
    setCreateError(null);
    setCreateSuccess(null);

    try {
      const selectedProject = projects.find((project) => project.name === createForm.projectName) || projects[0];
      if (createForm.frequency === 'once' && !createForm.runAt) {
        throw new Error('请选择一次性任务的执行时间。');
      }

      const schedule = createForm.frequency === 'once'
        ? { type: 'once' as const, runAt: new Date(createForm.runAt).toISOString() }
        : { type: 'cron' as const, expression: buildCronExpression(createForm) };

      const response = await api.cronCreate({
        message: buildCronMessage(createForm),
        schedule,
        projectName: selectedProject?.name,
        projectKey: selectedProject?.fullPath,
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      setCreateSuccess('定时任务已创建，正在刷新列表。');
      await refresh();
      setTimeout(() => {
        setCreateOpen(false);
        setCreateSuccess(null);
      }, 450);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : '创建定时任务失败。');
    } finally {
      setCreating(false);
    }
  }, [createForm, projects, refresh]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const grouped = useMemo(() => {
    const projectMap = new Map<string, Project>();
    for (const p of projects) projectMap.set(p.name, p);

    const result = new Map<string, { displayName: string; items: UnifiedItem[] }>();

    for (const [projectName, plans] of plansByProject) {
      const project = projectMap.get(projectName);
      const displayName = project?.displayName || projectName;
      if (!result.has(projectName)) {
        result.set(projectName, { displayName, items: [] });
      }
      for (const plan of plans) {
        result.get(projectName)!.items.push({
          kind: 'plan',
          data: plan,
          projectName,
          projectDisplayName: displayName,
          projectKey: project?.fullPath || '',
        });
      }
    }

    const activeCronJobs = cronJobs.filter(
      (j) => j.status === 'scheduled' || j.status === 'running',
    );

    const projectKeyToName = new Map<string, string>();
    for (const p of projects) {
      projectKeyToName.set(p.name, p.name);
      if (p.fullPath) projectKeyToName.set(p.fullPath, p.name);
    }

    for (const job of activeCronJobs) {
      const projectName = job.projectKey
        ? (projectKeyToName.get(job.projectKey) || job.projectKey)
        : '__unassigned__';
      const project = projectMap.get(projectName);
      const displayName = project?.displayName || (projectName === '__unassigned__' ? '' : projectName);

      if (!result.has(projectName)) {
        result.set(projectName, { displayName, items: [] });
      }
      result.get(projectName)!.items.push({
        kind: 'cron',
        data: job,
        projectName,
        projectDisplayName: displayName,
        projectKey: project?.fullPath || '',
      });
    }

    for (const group of result.values()) {
      group.items.sort((a, b) => {
        const timeA = Date.parse(a.data.createdAt) || 0;
        const timeB = Date.parse(b.data.createdAt) || 0;
        return timeB - timeA;
      });
    }

    return result;
  }, [projects, plansByProject, cronJobs]);

  const totalItems = useMemo(() => {
    let count = 0;
    for (const group of grouped.values()) count += group.items.length;
    return count;
  }, [grouped]);

  const toggleProject = (key: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="w-full space-y-5 px-8 py-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            {t('plansCron.title', { defaultValue: '计划与定时任务' })}
          </h2>
          <p className="mt-0.5 text-[13px] text-neutral-500 dark:text-neutral-400">
            {t('plansCron.subtitle', { defaultValue: '所有项目的计划与定时任务。' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 text-xxs text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} strokeWidth={1.75} />
            <span>{t('actions.refresh', { defaultValue: '刷新' })}</span>
          </button>
          <button
            type="button"
            onClick={() => openCreate()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-neutral-900 px-3 text-xxs font-medium text-white transition hover:opacity-90 dark:bg-neutral-50 dark:text-neutral-900"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            <span>创建</span>
          </button>
        </div>
      </div>

      {error ? (
        <div className="flex items-center gap-2 text-xxs text-red-500">
          <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span>{error}</span>
        </div>
      ) : null}

      {loading && totalItems === 0 ? (
        <div className="flex items-center gap-2 py-8 text-[13px] text-neutral-500 dark:text-neutral-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
          <span>{t('plansCron.loading', { defaultValue: '正在加载计划与定时任务...' })}</span>
        </div>
      ) : totalItems === 0 && !loading ? (
        <div className="rounded-2xl border border-neutral-200 py-12 text-center dark:border-neutral-800">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
            <FileText className="h-7 w-7" strokeWidth={1.25} />
          </div>
          <h3 className="text-[18px] font-semibold text-neutral-900 dark:text-neutral-100">还没有定时任务</h3>
          <p className="mx-auto mt-2 max-w-xl text-[13px] leading-6 text-neutral-500 dark:text-neutral-400">
            选择下方模板一键创建，或在对话中说明需要周期执行的工作。
          </p>
          <button
            type="button"
            onClick={() => openCreate()}
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-neutral-900 px-5 text-[14px] font-medium text-white transition hover:opacity-90 dark:bg-neutral-50 dark:text-neutral-900"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            创建
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {[...grouped.entries()].map(([projectKey, { displayName, items }]) => {
            const isCollapsed = collapsedProjects.has(projectKey);
            const label =
              projectKey === '__unassigned__'
                ? t('plansCron.unassigned', { defaultValue: '未关联项目' })
                : displayName;

            return (
              <div
                key={projectKey}
                className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
              >
                {/* Project group header */}
                <button
                  type="button"
                  onClick={() => toggleProject(projectKey)}
                  className="flex w-full items-center gap-2 px-5 py-3 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={1.75} />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={1.75} />
                  )}
                  <span className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
                    {label}
                  </span>
                  <span className="ml-auto text-xxs tabular-nums text-neutral-400 dark:text-neutral-500">
                    {items.length}
                  </span>
                </button>

                {!isCollapsed && (() => {
                  const planItems = items.filter((i) => i.kind === 'plan');
                  const cronItems = items.filter((i) => i.kind === 'cron');
                  const cycles = cyclesByProject.get(projectKey) ?? [];
                  const activeCycle = cycles.find((c) => c.status === 'active' || c.status === 'applying');
                  const hasCompletedPlan = planItems.some((p) => (p.data as DiscoveryPlanOverview).status === 'completed');
                  const canApply = !!activeCycle && activeCycle.status === 'active' && hasCompletedPlan;
                  const canArchive = !!activeCycle && activeCycle.status === 'active';
                  const isApplying = activeCycle?.status === 'applying';
                  const busy = !!activeCycle && cycleBusy === activeCycle.id;

                  const handleApply = async () => {
                    if (!activeCycle || busy) return;
                    setCycleBusy(activeCycle.id);
                    try {
                      if (onApplyWorkCycle) {
                        await onApplyWorkCycle(projectKey, activeCycle.id);
                      } else {
                        const res = await api.applyWorkCycle(projectKey, activeCycle.id);
                        if (!res.ok) {
                          const body = await res.json().catch(() => ({})) as { error?: string };
                          throw new Error(body?.error || `HTTP ${res.status}`);
                        }
                      }
                      await refresh();
                    } catch {
                      // Visible via refresh.
                    } finally {
                      setCycleBusy(null);
                    }
                  };

                  const handleArchive = async () => {
                    if (!activeCycle || busy) return;
                    setCycleBusy(activeCycle.id);
                    try {
                      const res = await api.archiveWorkCycle(projectKey, activeCycle.id);
                      if (!res.ok) {
                        const body = await res.json().catch(() => ({})) as { error?: string };
                        throw new Error(body?.error || `HTTP ${res.status}`);
                      }
                      await refresh();
                    } catch {
                      // Visible via refresh.
                    } finally {
                      setCycleBusy(null);
                      setConfirmingArchiveCycle(null);
                    }
                  };

                  const confirmingArchive = !!activeCycle && confirmingArchiveCycle === activeCycle.id;

                  return (
                    <>
                      {/* Plans sub-section */}
                      {planItems.length > 0 && (
                        <SubSection
                          sectionKey={`${projectKey}::plans`}
                          label={`${t('plansCron.type.plan', { defaultValue: '计划' })} (${planItems.length})`}
                          collapsedSections={collapsedSections}
                          toggleSection={toggleSection}
                          actions={
                            <div className="flex items-center gap-1.5">
                              {isApplying && (
                                <span className="inline-flex items-center gap-1 text-xxs text-sky-600 dark:text-sky-400">
                                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                                  {t('plansCron.cycleStatus.applying', { defaultValue: '正在应用...' })}
                                </span>
                              )}
                              {canApply && !isApplying && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void handleApply()}
                                  className="inline-flex h-7 items-center rounded-md bg-emerald-600 px-2.5 text-[11px] font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-700 dark:hover:bg-emerald-600"
                                >
                                  {busy ? (
                                    <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                                  ) : (
                                    t('plansCron.actions.applyCycle', { defaultValue: '全部应用' })
                                  )}
                                </button>
                              )}
                              {canArchive && !confirmingArchive && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => setConfirmingArchiveCycle(activeCycle!.id)}
                                  className="inline-flex h-7 items-center rounded-md border border-neutral-200 px-2 text-neutral-500 transition hover:border-red-300 hover:text-red-600 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-red-700 dark:hover:text-red-400"
                                  title={t('plansCron.actions.archiveCycle', { defaultValue: '归档' })}
                                >
                                  <Archive className="h-3.5 w-3.5" strokeWidth={1.75} />
                                </button>
                              )}
                              {confirmingArchive && (
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void handleArchive()}
                                    className="inline-flex h-7 items-center rounded-md bg-red-600 px-2.5 text-[11px] font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
                                  >
                                    {busy ? (
                                      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                                    ) : (
                                      t('plansCron.actions.archiveCycle', { defaultValue: '归档' })
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmingArchiveCycle(null)}
                                    className="inline-flex h-7 items-center rounded-md border border-neutral-200 px-2 text-[11px] text-neutral-500 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                                  >
                                    ✕
                                  </button>
                                </div>
                              )}
                            </div>
                          }
                        >
                          <ColumnHeaders t={t} />
                          <div className="divide-y divide-neutral-100 dark:divide-neutral-900">
                            {planItems.map((item) => (
                              <ItemRow
                                key={`plan-${item.data.id}`}
                                item={item}
                                t={t}
                                onRefresh={refresh}
                                onOpenPlanDetail={onOpenPlanDetail}
                              />
                            ))}
                          </div>
                        </SubSection>
                      )}

                      {/* Cron Jobs sub-section */}
                      {cronItems.length > 0 && (
                        <SubSection
                          sectionKey={`${projectKey}::crons`}
                          label={`${t('plansCron.type.cronJob', { defaultValue: '定时任务' })} (${cronItems.length})`}
                          collapsedSections={collapsedSections}
                          toggleSection={toggleSection}
                        >
                          <ColumnHeaders t={t} />
                          <div className="divide-y divide-neutral-100 dark:divide-neutral-900">
                            {cronItems.map((item) => (
                              <ItemRow
                                key={`cron-${item.data.id}`}
                                item={item}
                                t={t}
                                onRefresh={refresh}
                                onOpenPlanDetail={onOpenPlanDetail}
                              />
                            ))}
                          </div>
                        </SubSection>
                      )}
                    </>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-[16px] font-semibold text-neutral-900 dark:text-neutral-100">
          <span className="h-5 w-1 rounded-full bg-amber-500" />
          试试下面任务
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {CRON_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => openCreate(template)}
              className="group rounded-2xl border border-neutral-200 bg-neutral-50 p-5 text-left transition hover:border-neutral-300 hover:bg-white dark:border-neutral-800 dark:bg-neutral-900/70 dark:hover:border-neutral-700 dark:hover:bg-neutral-900"
            >
              <div className="flex min-h-28 flex-col">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-[16px] font-semibold text-neutral-900 dark:text-neutral-100">
                      {template.title}
                    </h3>
                    <p className="mt-2 text-[13px] leading-5 text-neutral-500 dark:text-neutral-400">
                      {template.description}
                    </p>
                  </div>
                  <ChevronRight
                    className="mt-1 h-5 w-5 shrink-0 text-neutral-400 transition group-hover:translate-x-0.5 group-hover:text-neutral-700 dark:group-hover:text-neutral-200"
                    strokeWidth={1.75}
                  />
                </div>
                <div className="mt-5 flex items-center gap-2 border-t border-neutral-200 pt-3 text-[13px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                  <Clock3 className="h-4 w-4" strokeWidth={1.75} />
                  {FREQUENCY_LABEL[template.frequency]} {template.time}
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {createOpen ? (
        <CreateCronModal
          form={createForm}
          projects={projects}
          selectedTemplateId={selectedTemplateId}
          creating={creating}
          error={createError}
          success={createSuccess}
          showAdvanced={showAdvanced}
          onClose={closeCreate}
          onSubmit={handleCreateCron}
          onUpdate={updateCreateForm}
          onToggleAdvanced={() => setShowAdvanced((value) => !value)}
          onUseTemplate={() => openCreate(CRON_TEMPLATES[0])}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible sub-section (Plans / Cron Jobs within a project card)
// ---------------------------------------------------------------------------

function SubSection({
  sectionKey,
  label,
  collapsedSections,
  toggleSection,
  actions,
  children,
}: {
  sectionKey: string;
  label: string;
  collapsedSections: Set<string>;
  toggleSection: (key: string) => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const isCollapsed = collapsedSections.has(sectionKey);
  return (
    <>
      <div className="flex items-center gap-2 border-t border-neutral-200 bg-neutral-50/80 px-5 py-2 dark:border-neutral-800 dark:bg-neutral-900/30">
        <button
          type="button"
          onClick={() => toggleSection(sectionKey)}
          className="flex items-center gap-1.5 text-xxs font-semibold uppercase tracking-wider text-neutral-500 transition-colors hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
        >
          {isCollapsed ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          )}
          {label}
        </button>
        {!isCollapsed && actions && <div className="ml-auto">{actions}</div>}
      </div>
      {!isCollapsed && children}
    </>
  );
}

function CreateCronModal({
  form,
  projects,
  selectedTemplateId,
  creating,
  error,
  success,
  showAdvanced,
  onClose,
  onSubmit,
  onUpdate,
  onToggleAdvanced,
  onUseTemplate,
}: {
  form: CronCreateForm;
  projects: Project[];
  selectedTemplateId: string | null;
  creating: boolean;
  error: string | null;
  success: string | null;
  showAdvanced: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onUpdate: <K extends keyof CronCreateForm>(key: K, value: CronCreateForm[K]) => void;
  onToggleAdvanced: () => void;
  onUseTemplate: () => void;
}) {
  const selectedTemplate = selectedTemplateId
    ? CRON_TEMPLATES.find((template) => template.id === selectedTemplateId)
    : null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 px-4 py-6 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-start justify-between gap-4 px-7 py-6">
          <div>
            <div className="flex items-center gap-3">
              <h3 className="text-[26px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
                添加定时任务
              </h3>
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-neutral-300 text-[13px] font-medium text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                ?
              </span>
            </div>
            <p className="mt-2 text-[13px] text-neutral-500 dark:text-neutral-400">
              到点后 OPC Brain 会自动把指令提交给后台任务运行。
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onUseTemplate}
              disabled={creating}
              className="hidden h-10 items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-4 text-[14px] font-medium text-neutral-700 transition hover:bg-white disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-900/70 sm:inline-flex"
            >
              从模板创建
              <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={creating}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-neutral-300 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
              aria-label="关闭添加定时任务窗口"
            >
              <X className="h-5 w-5" strokeWidth={2} />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-7 pb-6">
          {selectedTemplate ? (
            <div className="inline-flex items-center gap-2 rounded-full bg-neutral-100 px-3 py-1 text-[12px] text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
              已套用模板：{selectedTemplate.title}
            </div>
          ) : null}

          <label className="block space-y-2">
            <span className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
              标题<span className="text-red-500">*</span>
            </span>
            <input
              value={form.title}
              onChange={(event) => onUpdate('title', event.target.value)}
              placeholder="输入任务名称"
              className="h-12 w-full rounded-xl border border-neutral-300 bg-white px-4 text-[15px] text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-500 dark:focus:ring-neutral-800"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
              指令词<span className="text-red-500">*</span>
            </span>
            <textarea
              value={form.prompt}
              onChange={(event) => onUpdate('prompt', event.target.value)}
              placeholder="描述你希望定期自动执行的任务，可生成文档、PPT、表格、网站、图片、播客、视频等"
              rows={8}
              className="w-full resize-none rounded-xl border border-neutral-300 bg-white px-4 py-3 text-[15px] leading-6 text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-500 dark:focus:ring-neutral-800"
            />
          </label>

          <div className="space-y-2">
            <span className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">执行时间</span>
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                value={form.frequency}
                onChange={(event) => onUpdate('frequency', event.target.value as CronFrequency)}
                className="h-11 rounded-xl border border-neutral-300 bg-white px-4 text-[15px] text-neutral-900 outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-800"
              >
                <option value="daily">每天</option>
                <option value="weekly">每周</option>
                <option value="monthly">每月</option>
                <option value="once">仅一次</option>
              </select>
              {form.frequency === 'once' ? (
                <input
                  type="datetime-local"
                  value={form.runAt}
                  onChange={(event) => onUpdate('runAt', event.target.value)}
                  className="h-11 rounded-xl border border-neutral-300 bg-white px-4 text-[15px] text-neutral-900 outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-800"
                />
              ) : (
                <input
                  type="time"
                  value={form.time}
                  onChange={(event) => onUpdate('time', event.target.value)}
                  className="h-11 rounded-xl border border-neutral-300 bg-white px-4 text-[15px] text-neutral-900 outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-800"
                />
              )}
            </div>

            {form.frequency === 'weekly' ? (
              <select
                value={form.weekday}
                onChange={(event) => onUpdate('weekday', event.target.value)}
                className="h-10 w-full rounded-xl border border-neutral-300 bg-white px-3 text-[13px] text-neutral-900 outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-800 sm:w-56"
              >
                <option value="1">每周一</option>
                <option value="2">每周二</option>
                <option value="3">每周三</option>
                <option value="4">每周四</option>
                <option value="5">每周五</option>
                <option value="6">每周六</option>
                <option value="0">每周日</option>
              </select>
            ) : null}

            {form.frequency === 'monthly' ? (
              <label className="flex items-center gap-2 text-[13px] text-neutral-500 dark:text-neutral-400">
                每月第
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={form.monthDay}
                  onChange={(event) => onUpdate('monthDay', event.target.value)}
                  className="h-9 w-20 rounded-lg border border-neutral-300 bg-white px-3 text-neutral-900 outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-800"
                />
                天
              </label>
            ) : null}
          </div>

          <div>
            <button
              type="button"
              onClick={onToggleAdvanced}
              className="flex items-center gap-2 text-[14px] font-medium text-neutral-500 transition hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              高级设置
              <ChevronDown
                className={cn('h-4 w-4 transition-transform', showAdvanced && 'rotate-180')}
                strokeWidth={1.75}
              />
            </button>
            {showAdvanced ? (
              <label className="mt-3 block space-y-2">
                <span className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">所属项目</span>
                <select
                  value={form.projectName}
                  onChange={(event) => onUpdate('projectName', event.target.value)}
                  className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-[13px] text-neutral-900 outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-800"
                >
                  {projects.map((project) => (
                    <option key={project.name} value={project.name}>
                      {project.displayName || project.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </div>
          ) : null}

          {success ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
              {success}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-3 px-7 py-5">
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="h-10 rounded-lg px-5 text-[14px] font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-900"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={creating || !form.title.trim() || !form.prompt.trim()}
            className="inline-flex h-10 min-w-32 items-center justify-center gap-2 rounded-xl bg-neutral-900 px-5 text-[14px] font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-neutral-400 disabled:text-neutral-700 dark:bg-neutral-50 dark:text-neutral-900 dark:disabled:bg-neutral-700 dark:disabled:text-neutral-400"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : null}
            确认
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column headers (shared between Plans and Cron Jobs sub-sections)
// ---------------------------------------------------------------------------

function ColumnHeaders({ t }: { t: (key: string, opts?: Record<string, string>) => string }) {
  return (
    <div className="flex items-center gap-4 border-b border-neutral-200 bg-neutral-50 px-5 py-2 dark:border-neutral-800 dark:bg-neutral-900/50">
      <div className={COL.title}>
        <span className="text-xxs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          {t('plansCron.columns.title', { defaultValue: '标题' })}
        </span>
      </div>
      <div className={COL.createdAt}>
        <span className="text-xxs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          {t('plansCron.columns.createdAt', { defaultValue: '创建时间' })}
        </span>
      </div>
      <div className={COL.status}>
        <span className="text-xxs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          {t('plansCron.columns.status', { defaultValue: '状态' })}
        </span>
      </div>
      <div className={COL.actions}>
        <span className="text-xxs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          {t('plansCron.columns.actions', { defaultValue: '操作' })}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table row (plan or cron)
// ---------------------------------------------------------------------------

function ItemRow({
  item,
  t,
  onRefresh,
  onOpenPlanDetail,
}: {
  item: UnifiedItem;
  t: (key: string, opts?: Record<string, string>) => string;
  onRefresh: () => Promise<void>;
  onOpenPlanDetail?: (planId: string, projectName: string, projectDisplayName: string, sourceRunId: string, projectKey: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  const isPlan = item.kind === 'plan';
  const plan = isPlan ? item.data : null;
  const job = isPlan ? null : item.data;

  const title = isPlan ? (plan!.title || '—') : (job!.prompt || '—');
  const fullTitle = isPlan ? (plan!.title || '') : (job!.prompt || '');
  const createdAt = isPlan ? plan!.createdAt : job!.createdAt;

  let statusLabel: string;
  let statusStyle: string;
  let displayStatus: PlanDisplayStatus | null = null;
  if (isPlan) {
    displayStatus = mapPlanStatus(plan!.status);
    const meta = PLAN_STATUS_LABEL[displayStatus];
    statusLabel = t(meta.key, { defaultValue: meta.defaultValue });
    statusStyle = PLAN_STATUS_STYLE[displayStatus];
  } else {
    const cs: 'scheduled' | 'running' = job!.status === 'running' ? 'running' : 'scheduled';
    const meta = CRON_STATUS_LABEL[cs];
    statusLabel = t(meta.key, { defaultValue: meta.defaultValue });
    statusStyle = CRON_STATUS_STYLE[cs];
  }

  const showRetry = isPlan && displayStatus === 'failed';

  const handleRetry = async () => {
    if (!plan || busy) return;
    setBusy(true);
    try {
      const res = await api.executeProjectDiscoveryPlan(item.projectName, plan.id, { source: 'manual' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      await onRefresh();
    } catch {
      // Visible via refresh.
    } finally {
      setBusy(false);
    }
  };

  const handleCronDelete = async () => {
    if (!job || busy) return;
    setBusy(true);
    try {
      const res = await api.cronDelete(job.id);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      await onRefresh();
    } catch {
      // Visible via refresh.
    } finally {
      setBusy(false);
    }
  };

  const handleCronRunNow = async () => {
    if (!job || busy) return;
    setBusy(true);
    try {
      const res = await api.cronRunNow(job.id);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      await onRefresh();
    } catch {
      // Visible via refresh.
    } finally {
      setBusy(false);
    }
  };

  const handleCronStop = async () => {
    if (!job || busy) return;
    setBusy(true);
    try {
      const res = await api.cronStop(job.id);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      await onRefresh();
    } catch {
      // Visible via refresh.
    } finally {
      setBusy(false);
    }
  };

  const cronIsRunning = !isPlan && job?.status === 'running';

  return (
    <div className="flex items-center gap-4 px-5 py-2.5 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900/40">
      {/* Title */}
      <div className={cn(COL.title, 'truncate text-[13px] text-neutral-900 dark:text-neutral-100')} title={fullTitle}>
        {isPlan && onOpenPlanDetail ? (
          <button
            type="button"
            onClick={() => onOpenPlanDetail(plan!.id, item.projectName, item.projectDisplayName, (plan as DiscoveryPlanOverview).sourceRunId || (plan as DiscoveryPlanOverview).sourceDiscoverySessionId || '', item.projectKey)}
            className="truncate text-left hover:underline"
          >
            {title}
          </button>
        ) : (
          title
        )}
      </div>

      {/* Created */}
      <div className={cn(COL.createdAt, 'font-mono text-xxs tabular-nums text-neutral-500 dark:text-neutral-400')}>
        {formatAbsoluteTime(createdAt)}
      </div>

      {/* Status */}
      <div className={COL.status}>
        <span className={cn('inline-block rounded-full px-2 py-0.5 text-[11px] font-medium', statusStyle)}>
          {statusLabel}
        </span>
      </div>

      {/* Actions */}
      <div className={cn(COL.actions, 'flex items-center gap-1.5')}>
        {isPlan ? (
          <>
            {showRetry && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleRetry()}
                className="inline-flex h-7 items-center rounded-md bg-blue-600 px-2.5 text-[11px] font-medium text-white transition hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-700 dark:hover:bg-blue-600"
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                ) : (
                  t('plansCron.actions.retry', { defaultValue: '重新执行' })
                )}
              </button>
            )}
          </>
        ) : (
          <>
            {cronIsRunning ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleCronStop()}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-red-600 px-2.5 text-[11px] font-medium text-white transition hover:bg-red-700 disabled:opacity-50 dark:bg-red-700 dark:hover:bg-red-600"
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                ) : (
                  <>
                    <Square className="h-3 w-3" strokeWidth={2} />
                    {t('plansCron.actions.stop', { defaultValue: '停止' })}
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleCronRunNow()}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-blue-600 px-2.5 text-[11px] font-medium text-white transition hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-700 dark:hover:bg-blue-600"
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                ) : (
                  <>
                    <Play className="h-3 w-3" strokeWidth={2} />
                    {t('plansCron.actions.runNow', { defaultValue: '立即运行' })}
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleCronDelete()}
              className="inline-flex h-7 items-center rounded-md border border-neutral-200 px-2 text-neutral-500 transition hover:border-red-300 hover:text-red-600 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-red-700 dark:hover:text-red-400"
              title={t('plansCron.actions.delete', { defaultValue: '删除' })}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
