import {
  ChevronLeft,
  ChevronRight,
  Code2,
  FileText,
  Globe2,
  GripVertical,
  Image,
  Plus,
  PlayCircle,
  RotateCcw,
  SearchCode,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  EyeOff,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type QuickTool = {
  id: string;
  label: string;
  icon: LucideIcon;
  prompt: string;
  comingSoon?: boolean;
};

type QuickToolsProps = {
  disabled?: boolean;
  onRunTool: (prompt: string) => void;
};

const QUICK_TOOLS: QuickTool[] = [
  {
    id: 'code',
    label: '写代码',
    icon: Code2,
    prompt: '帮我基于当前项目实现一个小功能。先阅读相关代码，再给出实现并验证。',
  },
  {
    id: 'search',
    label: '搜代码',
    icon: SearchCode,
    prompt: '帮我在当前项目里查找相关代码位置，并总结关键实现路径。',
  },
  {
    id: 'web',
    label: '抓网页',
    icon: Globe2,
    prompt: '帮我抓取并整理一个网页内容。请先问我要 URL，之后提炼重点。',
  },
  {
    id: 'slides',
    label: '生成 PPT',
    icon: Sparkles,
    prompt: '帮我把现有材料整理成一份 PPT 大纲，并说明每页内容。',
  },
  {
    id: 'cleanup',
    label: '清理文件',
    icon: Trash2,
    prompt: '帮我分析当前项目里可以清理的临时文件和构建产物。先列清单，不要直接删除。',
  },
  {
    id: 'test',
    label: '跑测试',
    icon: PlayCircle,
    prompt: '帮我运行当前项目的相关测试，定位失败原因，并给出修复建议。',
  },
  {
    id: 'docs',
    label: '写文档',
    icon: FileText,
    prompt: '帮我根据当前项目代码补充一份简洁的开发文档。',
  },
  {
    id: 'image',
    label: '生成图片',
    icon: Image,
    prompt: '帮我生成一张图片。',
    comingSoon: true,
  },
];

const STORAGE_KEY = 'opcbrain-home-quick-tools-v1';
const DEFAULT_ORDER = QUICK_TOOLS.map((tool) => tool.id);

type QuickToolState = {
  order: string[];
  hidden: string[];
};

function normalizeState(value: Partial<QuickToolState> | null | undefined): QuickToolState {
  const knownIds = new Set(DEFAULT_ORDER);
  const order = Array.isArray(value?.order)
    ? value.order.filter((id): id is string => typeof id === 'string' && knownIds.has(id))
    : [];
  const mergedOrder = [
    ...order,
    ...DEFAULT_ORDER.filter((id) => !order.includes(id)),
  ];
  const hidden = Array.isArray(value?.hidden)
    ? Array.from(new Set(value.hidden.filter((id): id is string => typeof id === 'string' && knownIds.has(id))))
    : [];

  return { order: mergedOrder, hidden };
}

function readStoredState(): QuickToolState {
  if (typeof window === 'undefined') return normalizeState(null);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return normalizeState(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeState(null);
  }
}

export default function QuickTools({ disabled = false, onRunTool }: QuickToolsProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [toolState, setToolState] = useState<QuickToolState>(() => readStoredState());

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toolState));
    } catch {
      // Local customization is optional; ignore storage failures.
    }
  }, [toolState]);

  const toolsById = useMemo(() => new Map(QUICK_TOOLS.map((tool) => [tool.id, tool])), []);
  const orderedTools = useMemo(
    () => toolState.order.map((id) => toolsById.get(id)).filter((tool): tool is QuickTool => Boolean(tool)),
    [toolState.order, toolsById],
  );
  const hiddenIds = useMemo(() => new Set(toolState.hidden), [toolState.hidden]);
  const visibleTools = orderedTools.filter((tool) => !hiddenIds.has(tool.id));
  const hiddenTools = orderedTools.filter((tool) => hiddenIds.has(tool.id));

  const updateOrder = (nextOrder: string[]) => {
    setToolState((current) => normalizeState({ ...current, order: nextOrder }));
  };

  const moveTool = (toolId: string, direction: -1 | 1) => {
    const index = toolState.order.indexOf(toolId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= toolState.order.length) return;
    const nextOrder = [...toolState.order];
    [nextOrder[index], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[index]];
    updateOrder(nextOrder);
  };

  const moveToolBefore = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const nextOrder = toolState.order.filter((id) => id !== sourceId);
    const targetIndex = nextOrder.indexOf(targetId);
    if (targetIndex < 0) return;
    nextOrder.splice(targetIndex, 0, sourceId);
    updateOrder(nextOrder);
  };

  const hideTool = (toolId: string) => {
    setToolState((current) => normalizeState({ ...current, hidden: [...current.hidden, toolId] }));
  };

  const showTool = (toolId: string) => {
    setToolState((current) => normalizeState({
      ...current,
      hidden: current.hidden.filter((id) => id !== toolId),
    }));
  };

  const resetTools = () => {
    setToolState(normalizeState(null));
  };

  return (
    <section className="animate-fade-in" style={{ animationDelay: '260ms' }}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">快捷工具</h2>
        <div className="flex items-center gap-1.5">
          {isEditing ? (
            <button
              type="button"
              onClick={resetTools}
              title="恢复默认快捷工具"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-surface-500 transition hover:bg-surface-100 hover:text-surface-900 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-surface-100"
            >
              <RotateCcw className="h-4 w-4" strokeWidth={1.75} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setIsEditing((value) => !value)}
            title={isEditing ? '完成编辑' : '编辑快捷工具'}
            className={
              isEditing
                ? 'inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-600 px-2.5 text-xs font-semibold text-white transition hover:bg-brand-700'
                : 'inline-flex h-8 w-8 items-center justify-center rounded-lg text-surface-500 transition hover:bg-surface-100 hover:text-surface-900 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-surface-100'
            }
          >
            <SlidersHorizontal className="h-4 w-4" strokeWidth={1.75} />
            {isEditing ? <span>完成</span> : null}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-7">
        {visibleTools.map((tool) => {
          const Icon = tool.icon;
          const isUnavailable = disabled || tool.comingSoon;
          return (
            <div
              key={tool.id}
              draggable={isEditing}
              onDragStart={(event) => {
                setDraggingId(tool.id);
                event.dataTransfer.setData('text/plain', tool.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => {
                if (isEditing && draggingId && draggingId !== tool.id) {
                  event.preventDefault();
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                const sourceId = event.dataTransfer.getData('text/plain') || draggingId;
                if (sourceId) moveToolBefore(sourceId, tool.id);
                setDraggingId(null);
              }}
              onDragEnd={() => setDraggingId(null)}
              className="relative min-w-0"
            >
              <button
                type="button"
                disabled={isUnavailable || isEditing}
                title={tool.comingSoon ? '生成图片能力需要新增 image generation provider' : tool.label}
                onClick={() => onRunTool(tool.prompt)}
                className={
                  tool.comingSoon
                    ? 'group flex h-24 w-full min-w-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-surface-200 bg-surface-50 px-2 text-sm font-medium text-surface-400 transition-all duration-200 dark:border-surface-800 dark:bg-surface-900/60 dark:text-surface-500'
                    : 'group flex h-24 w-full min-w-0 flex-col items-center justify-center gap-2 rounded-xl border border-surface-200 bg-white px-2 text-sm font-medium text-surface-700 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:text-brand-700 hover:shadow-lg hover:shadow-surface-200/30 disabled:cursor-not-allowed disabled:opacity-50 dark:border-surface-800 dark:bg-surface-900 dark:text-surface-300 dark:hover:border-brand-900 dark:hover:text-brand-300 dark:hover:shadow-black/20'
                }
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-100 text-surface-500 transition group-hover:bg-brand-50 group-hover:text-brand-600 dark:bg-surface-800 dark:text-surface-400 dark:group-hover:bg-brand-900/30 dark:group-hover:text-brand-300">
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <span className="max-w-full truncate">{tool.label}</span>
                {tool.comingSoon ? (
                  <span className="text-[10px] font-semibold text-surface-400 dark:text-surface-500">即将支持</span>
                ) : null}
              </button>
              {isEditing ? (
                <div className="absolute inset-x-1 top-1 flex items-center justify-between">
                  <span
                    title="拖动排序"
                    className="inline-flex h-7 w-7 cursor-grab items-center justify-center rounded-md bg-white/90 text-surface-400 shadow-sm dark:bg-surface-800/90"
                  >
                    <GripVertical className="h-4 w-4" strokeWidth={1.75} />
                  </span>
                  <button
                    type="button"
                    onClick={() => hideTool(tool.id)}
                    title="隐藏"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-surface-500 shadow-sm transition hover:text-red-600 dark:bg-surface-800/90 dark:text-surface-300 dark:hover:text-red-400"
                  >
                    <EyeOff className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </div>
              ) : null}
              {isEditing ? (
                <div className="absolute inset-x-1 bottom-1 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => moveTool(tool.id, -1)}
                    title="向前移动"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-surface-500 shadow-sm transition hover:text-brand-700 disabled:opacity-40 dark:bg-surface-800/90 dark:text-surface-300"
                    disabled={toolState.order.indexOf(tool.id) <= 0}
                  >
                    <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveTool(tool.id, 1)}
                    title="向后移动"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-surface-500 shadow-sm transition hover:text-brand-700 disabled:opacity-40 dark:bg-surface-800/90 dark:text-surface-300"
                    disabled={toolState.order.indexOf(tool.id) >= toolState.order.length - 1}
                  >
                    <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {isEditing && hiddenTools.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {hiddenTools.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => showTool(tool.id)}
                title={`恢复 ${tool.label}`}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-surface-200 bg-white px-2 text-xs font-medium text-surface-600 transition hover:border-brand-200 hover:text-brand-700 dark:border-surface-800 dark:bg-surface-900 dark:text-surface-300 dark:hover:border-brand-900 dark:hover:text-brand-300"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>{tool.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
