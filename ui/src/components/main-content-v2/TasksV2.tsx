import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import { useTaskMaster } from '../../contexts/TaskMasterContext';
import type { TaskMasterTask, TaskPriority, TaskStatus } from '../task-master/types';
import { api, authenticatedFetch } from '../../utils/api';
import { cn } from '../../lib/utils.js';

type TasksV2Props = {
  isVisible: boolean;
};

type UpdatingState = {
  id: string;
  nextStatus: TaskStatus;
};

type TaskTemplate = {
  id: string;
  title: string;
  description: string;
  prompt: string;
  priority: 'high' | 'medium' | 'low';
  scheduleLabel: string;
};

type CreateTaskForm = {
  title: string;
  prompt: string;
  priority: 'high' | 'medium' | 'low';
  dependencies: string;
};

const EMPTY_FORM: CreateTaskForm = {
  title: '',
  prompt: '',
  priority: 'medium',
  dependencies: '',
};

const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'feature-plan',
    title: '功能开发任务',
    description: '把一个产品需求拆成可执行的开发步骤，包含验收标准和测试建议。',
    prompt: '请根据当前项目代码，拆解并实现一个功能开发任务。需要先说明执行计划，再逐步修改代码，最后运行必要测试并总结结果。',
    priority: 'high',
    scheduleLabel: '适合当前迭代',
  },
  {
    id: 'bugfix',
    title: '问题修复任务',
    description: '定位用户反馈或页面报错，找出根因并完成修复与验证。',
    prompt: '请定位并修复一个具体问题。需要先复现或确认现象，分析根因，完成最小范围修改，并运行相关验证。',
    priority: 'high',
    scheduleLabel: '发现问题时创建',
  },
  {
    id: 'refactor',
    title: '代码整理任务',
    description: '围绕一个模块做小范围重构，降低重复和维护成本。',
    prompt: '请对指定模块做小范围重构。保持外部行为不变，优先复用现有模式，补充必要测试并说明风险。',
    priority: 'medium',
    scheduleLabel: '每周维护',
  },
  {
    id: 'docs',
    title: '文档完善任务',
    description: '补齐 README、开发说明或模块说明，让后续维护更清晰。',
    prompt: '请完善项目文档。先检查现有 README 和相关 docs，再补充准确的安装、使用、架构或维护说明。',
    priority: 'medium',
    scheduleLabel: '功能完成后',
  },
  {
    id: 'test',
    title: '测试补强任务',
    description: '为高风险逻辑增加单元测试、集成测试或回归测试。',
    prompt: '请为指定功能补充测试。先识别关键行为和边界条件，再添加聚焦测试并运行验证。',
    priority: 'medium',
    scheduleLabel: '发布前',
  },
  {
    id: 'research',
    title: '技术调研任务',
    description: '调研实现方案、依赖库或架构取舍，并沉淀为可执行建议。',
    prompt: '请围绕指定技术问题做调研，比较可选方案、风险和实施成本，最后给出推荐方案和后续执行步骤。',
    priority: 'low',
    scheduleLabel: '需要决策时',
  },
];

function flattenTasks(tasks: TaskMasterTask[]): TaskMasterTask[] {
  const out: TaskMasterTask[] = [];
  const walk = (arr: TaskMasterTask[]) => {
    for (const task of arr) {
      out.push(task);
      if (Array.isArray(task.subtasks) && task.subtasks.length) walk(task.subtasks);
    }
  };
  walk(tasks);
  return out;
}

const STATUS_LABEL: Record<string, string> = {
  pending: '未开始',
  'in-progress': '进行中',
  done: '已完成',
  review: '待审核',
  blocked: '受阻',
  deferred: '已延期',
  cancelled: '已取消',
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  pending: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400',
  'in-progress':
    'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  review: 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
  blocked: 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  deferred: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500',
  cancelled: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500',
};

const PRIORITY_LABEL: Record<string, string> = {
  high: '高优先级',
  medium: '中优先级',
  low: '低优先级',
};

const PRIORITY_CLASS: Record<string, string> = {
  high: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/20',
  medium:
    'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20',
  low: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20',
};

async function readResponseMessage(response: Response) {
  try {
    const payload = (await response.json()) as { message?: string; error?: string };
    return payload.message || payload.error || `请求失败：${response.status}`;
  } catch {
    return `请求失败：${response.status}`;
  }
}

function buildTaskPrompt(form: CreateTaskForm) {
  const title = form.title.trim();
  const prompt = form.prompt.trim();

  if (!title) {
    return prompt;
  }

  return `任务标题：${title}\n\n任务说明：\n${prompt}`;
}

export default function TasksV2({ isVisible }: TasksV2Props) {
  const { t } = useTranslation();
  const {
    tasks,
    currentProject,
    refreshTasks,
    isLoadingTasks,
  } = useTaskMaster();
  const [updating, setUpdating] = useState<UpdatingState | null>(null);
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [showTemplates, setShowTemplates] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [form, setForm] = useState<CreateTaskForm>(EMPTY_FORM);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [isCreating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  const flat = useMemo(() => flattenTasks(tasks ?? []), [tasks]);
  const inProgressCount = flat.filter((task) => task.status === 'in-progress').length;
  const doneCount = flat.filter((task) => task.status === 'done').length;
  const blockedCount = flat.filter((task) => task.status === 'blocked').length;
  const canCreateTask = Boolean(currentProject?.name);

  const openCreateModal = useCallback((template?: TaskTemplate) => {
    if (template) {
      setSelectedTemplateId(template.id);
      setForm({
        title: template.title,
        prompt: template.prompt,
        priority: template.priority,
        dependencies: '',
      });
    } else {
      setSelectedTemplateId(null);
      setForm(EMPTY_FORM);
    }
    setCreateError(null);
    setCreateSuccess(null);
    setShowAdvanced(false);
    setCreateOpen(true);
  }, []);

  const closeCreateModal = useCallback(() => {
    if (isCreating) return;
    setCreateOpen(false);
    setCreateError(null);
    setCreateSuccess(null);
  }, [isCreating]);

  const updateForm = useCallback(
    <K extends keyof CreateTaskForm>(key: K, value: CreateTaskForm[K]) => {
      setForm((current) => ({ ...current, [key]: value }));
      setCreateError(null);
      setCreateSuccess(null);
    },
    [],
  );

  const handleToggle = useCallback(
    async (task: TaskMasterTask) => {
      const projectName = currentProject?.name;
      if (!projectName) return;
      const nextStatus: TaskStatus = task.status === 'done' ? 'pending' : 'done';
      setUpdating({ id: String(task.id), nextStatus });
      try {
        const response = await authenticatedFetch(
          `/api/taskmaster/update-task/${encodeURIComponent(projectName)}/${encodeURIComponent(String(task.id))}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: nextStatus }),
          },
        );
        if (response.ok) {
          void refreshTasks();
        }
      } catch (error) {
        console.error('Failed to update task status', error);
      } finally {
        setUpdating(null);
      }
    },
    [currentProject?.name, refreshTasks],
  );

  const handleCreateTask = useCallback(async () => {
    const projectName = currentProject?.name;
    const prompt = buildTaskPrompt(form);
    const title = form.title.trim();

    if (!projectName) {
      setCreateError('请先选择一个项目。');
      return;
    }

    if (!title) {
      setCreateError('请输入任务标题。');
      return;
    }

    if (!prompt) {
      setCreateError('请输入任务指令。');
      return;
    }

    setCreating(true);
    setCreateError(null);
    setCreateSuccess(null);

    try {
      const dependencies = form.dependencies
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .join(',');

      const response = await api.taskmaster.addTask(projectName, {
        prompt,
        title,
        description: form.prompt.trim(),
        priority: form.priority,
        dependencies: dependencies || undefined,
      });

      if (!response.ok) {
        throw new Error(await readResponseMessage(response));
      }

      setCreateSuccess('任务已创建，正在刷新列表。');
      await refreshTasks();
      setForm(EMPTY_FORM);
      setSelectedTemplateId(null);
      setTimeout(() => {
        setCreateOpen(false);
        setCreateSuccess(null);
      }, 450);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : '创建任务失败。');
    } finally {
      setCreating(false);
    }
  }, [currentProject?.name, form, refreshTasks]);

  if (!isVisible) return null;

  return (
    <div className="h-full overflow-y-auto bg-white dark:bg-neutral-950">
      <div className="mx-auto w-full max-w-[1040px] space-y-6 px-8 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-[20px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              任务
            </h2>
            <p className="mt-0.5 text-[13px] text-neutral-500 dark:text-neutral-400">
              {currentProject?.displayName || currentProject?.name || '当前项目'} · {flat.length} 个任务 · {inProgressCount} 个进行中
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshTasks()}
              className="text-xxs inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 text-neutral-700 transition hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-900"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isLoadingTasks && 'animate-spin')} strokeWidth={2} />
              <span>刷新</span>
            </button>
            <button
              type="button"
              onClick={() => openCreateModal()}
              disabled={!canCreateTask}
              className="text-xxs inline-flex h-8 items-center gap-1.5 rounded-md bg-neutral-900 px-3 text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-50 dark:text-neutral-900"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              <span>新建任务</span>
            </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <TaskStatCard label="全部任务" value={flat.length} />
          <TaskStatCard label="进行中" value={inProgressCount} tone="amber" />
          <TaskStatCard label="已完成" value={doneCount} tone="emerald" />
          <TaskStatCard label="受阻" value={blockedCount} tone="red" />
        </div>

        {isLoadingTasks && flat.length === 0 ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-neutral-200 py-10 text-[13px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
            <span>{t('loading', { defaultValue: '加载中...' })}</span>
          </div>
        ) : flat.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 p-10 text-center dark:border-neutral-800">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
              <Clock3 className="h-7 w-7" strokeWidth={1.75} />
            </div>
            <h3 className="text-[16px] font-semibold text-neutral-900 dark:text-neutral-100">还没有任务</h3>
            <p className="mx-auto mt-2 max-w-lg text-[13px] leading-6 text-neutral-500 dark:text-neutral-400">
              可以从下方模板一键创建，或手动描述一个希望 TaskMaster 跟踪和执行的任务。
            </p>
            <button
              type="button"
              onClick={() => openCreateModal()}
              disabled={!canCreateTask}
              className="mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-neutral-900 px-4 text-[13px] font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-50 dark:text-neutral-900"
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
              创建
            </button>
          </div>
        ) : (
          <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {flat.map((task) => {
              const isDone = task.status === 'done';
              const status = String(task.status ?? 'pending');
              const isUpdating = updating?.id === String(task.id);

              return (
                <label
                  key={String(task.id)}
                  className="flex cursor-pointer items-start gap-3 p-4 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900/60"
                >
                  <input
                    type="checkbox"
                    checked={isDone}
                    disabled={isUpdating}
                    onChange={() => void handleToggle(task)}
                    className="mt-0.5 h-4 w-4 accent-neutral-900 dark:accent-neutral-50"
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        'text-[13.5px]',
                        isDone
                          ? 'text-neutral-400 line-through dark:text-neutral-500'
                          : 'text-neutral-900 dark:text-neutral-100',
                      )}
                    >
                      {task.title}
                    </div>
                    <div className="text-xxs mt-0.5 text-neutral-500 dark:text-neutral-400">
                      {STATUS_LABEL[status] ?? status}
                      {task.priority ? ` · ${PRIORITY_LABEL[String(task.priority)] ?? task.priority}` : ''}
                    </div>
                    {task.description ? (
                      <p className="mt-2 line-clamp-2 text-[12.5px] leading-5 text-neutral-500 dark:text-neutral-400">
                        {task.description}
                      </p>
                    ) : null}
                  </div>
                  {status !== 'pending' && status !== 'done' ? (
                    <span
                      className={cn(
                        'rounded-md px-2 py-0.5 text-xxs',
                        STATUS_BADGE_CLASS[status] ??
                          'bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400',
                      )}
                    >
                      {STATUS_LABEL[status] ?? status}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
        )}

        <section className="space-y-3">
          <button
            type="button"
            onClick={() => setShowTemplates((value) => !value)}
            className="flex items-center gap-2 text-left text-[15px] font-semibold text-neutral-900 dark:text-neutral-100"
          >
            <span className="h-5 w-1 rounded-full bg-amber-500" />
            <span>试试下面任务</span>
            <ChevronDown
              className={cn('h-4 w-4 text-neutral-500 transition-transform', !showTemplates && '-rotate-90')}
              strokeWidth={1.75}
            />
          </button>
          {showTemplates ? (
            <div className="grid gap-4 md:grid-cols-2">
              {TASK_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => openCreateModal(template)}
                  className="group rounded-xl border border-neutral-200 bg-neutral-50 p-5 text-left transition hover:border-neutral-300 hover:bg-white dark:border-neutral-800 dark:bg-neutral-900/70 dark:hover:border-neutral-700 dark:hover:bg-neutral-900"
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
                      <ArrowRight
                        className="mt-1 h-4 w-4 shrink-0 text-neutral-400 transition group-hover:translate-x-0.5 group-hover:text-neutral-700 dark:group-hover:text-neutral-200"
                        strokeWidth={1.75}
                      />
                    </div>
                    <div className="mt-5 flex items-center justify-between border-t border-neutral-200 pt-3 text-[12px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock3 className="h-3.5 w-3.5" strokeWidth={1.75} />
                        {template.scheduleLabel}
                      </span>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-medium ring-1',
                          PRIORITY_CLASS[template.priority],
                        )}
                      >
                        {PRIORITY_LABEL[template.priority]}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      </div>

      {isCreateOpen ? (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950">
            <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-7 py-6 dark:border-neutral-800">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-[24px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
                    添加任务
                  </h3>
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-neutral-300 text-[13px] font-medium text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                    ?
                  </span>
                </div>
                <p className="mt-2 text-[13px] text-neutral-500 dark:text-neutral-400">
                  创建后会写入当前项目的 TaskMaster 任务列表。
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    const template = TASK_TEMPLATES[0];
                    openCreateModal(template);
                  }}
                  disabled={isCreating}
                  className="hidden h-9 items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-[13px] font-medium text-neutral-700 transition hover:bg-white disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-900/70 sm:inline-flex"
                >
                  <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                  从模板创建
                  <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  onClick={closeCreateModal}
                  disabled={isCreating}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-300 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
                  aria-label="关闭添加任务窗口"
                >
                  <X className="h-5 w-5" strokeWidth={2} />
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto px-7 py-6">
              {selectedTemplateId ? (
                <div className="inline-flex items-center gap-2 rounded-full bg-neutral-100 px-3 py-1 text-[12px] text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
                  已套用模板：{TASK_TEMPLATES.find((template) => template.id === selectedTemplateId)?.title}
                </div>
              ) : null}

              <label className="block space-y-2">
                <span className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
                  标题<span className="text-red-500">*</span>
                </span>
                <input
                  value={form.title}
                  onChange={(event) => updateForm('title', event.target.value)}
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
                  onChange={(event) => updateForm('prompt', event.target.value)}
                  placeholder="描述你希望 TaskMaster 跟踪或拆解的任务，例如：实现知识库文档上传后的解析、切片、检索和引用展示。"
                  rows={8}
                  className="w-full resize-none rounded-xl border border-neutral-300 bg-white px-4 py-3 text-[15px] leading-6 text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-500 dark:focus:ring-neutral-800"
                />
              </label>

              <div className="space-y-2">
                <span className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">优先级</span>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(['high', 'medium', 'low'] as const).map((priority) => (
                    <button
                      key={priority}
                      type="button"
                      onClick={() => updateForm('priority', priority)}
                      className={cn(
                        'flex h-10 items-center justify-center rounded-lg border text-[13px] font-medium transition',
                        form.priority === priority
                          ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                          : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-900',
                      )}
                    >
                      {form.priority === priority ? <Check className="h-4 w-4" strokeWidth={2} /> : null}
                      {PRIORITY_LABEL[priority]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced((value) => !value)}
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
                    <span className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                      依赖任务 ID
                    </span>
                    <input
                      value={form.dependencies}
                      onChange={(event) => updateForm('dependencies', event.target.value)}
                      placeholder="例如：1, 2.3"
                      className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-[13px] text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-500 dark:focus:ring-neutral-800"
                    />
                  </label>
                ) : null}
              </div>

              {createError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                  {createError}
                </div>
              ) : null}

              {createSuccess ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                  {createSuccess}
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-neutral-200 px-7 py-5 dark:border-neutral-800">
              <button
                type="button"
                onClick={closeCreateModal}
                disabled={isCreating}
                className="h-10 rounded-lg px-5 text-[14px] font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-900"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleCreateTask()}
                disabled={isCreating || !form.title.trim() || !form.prompt.trim()}
                className="inline-flex h-10 min-w-32 items-center justify-center gap-2 rounded-lg bg-neutral-900 px-5 text-[14px] font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-neutral-400 disabled:text-neutral-700 dark:bg-neutral-50 dark:text-neutral-900 dark:disabled:bg-neutral-700 dark:disabled:text-neutral-400"
              >
                {isCreating ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : null}
                确认
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TaskStatCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'amber' | 'emerald' | 'red';
}) {
  const toneClass = {
    neutral: 'text-neutral-900 dark:text-neutral-100',
    amber: 'text-amber-700 dark:text-amber-300',
    emerald: 'text-emerald-700 dark:text-emerald-300',
    red: 'text-red-700 dark:text-red-300',
  }[tone];

  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/60">
      <div className={cn('text-[22px] font-semibold tabular-nums', toneClass)}>{value}</div>
      <div className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-400">{label}</div>
    </div>
  );
}
