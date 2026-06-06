import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BarChart3,
  Bot,
  Brain,
  ClipboardList,
  Folder,
  GitBranch,
  Home,
  Plus,
  Radio,
  Search,
  Settings,
  Sparkles,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import type { AppTab, Project, ProjectSession } from '../../../types/app';
import type { HomeSessionCard } from '../../../hooks/useHomeDashboardData';
import { formatHomeRelativeTime } from '../../../hooks/useHomeDashboardData';
import { getSessionTimestamp, projectName, sessionTitle } from './homeUtils';

type CommandPaletteProps = {
  isOpen: boolean;
  projects: Project[];
  recentProjects: Project[];
  unreadSessions: HomeSessionCard[];
  onClose: () => void;
  onOpenHome: () => void;
  onOpenTab: (tab: AppTab) => void;
  onOpenProject: (projectName: string) => void;
  onOpenSession: (item: HomeSessionCard) => void;
  onCreateProject?: () => void;
  onOpenSettings: () => void;
};

type CommandItem = {
  id: string;
  group: '操作' | '项目' | '会话' | '未读';
  title: string;
  subtitle: string;
  icon: LucideIcon;
  keywords: string;
  run: () => void;
};

const NAV_COMMANDS: Array<{
  id: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  tab?: AppTab;
}> = [
  { id: 'home', title: '首页', subtitle: '返回控制台概览', icon: Home, tab: 'home' },
  { id: 'chat', title: '会话', subtitle: '打开默认工作区会话', icon: Bot, tab: 'chat' },
  { id: 'files', title: '文件', subtitle: '查看项目文件', icon: Folder, tab: 'files' },
  { id: 'always-on', title: '后台任务', subtitle: '查看 Always-On 后台任务', icon: Radio, tab: 'always-on' },
  { id: 'tasks', title: '任务', subtitle: '查看 TaskMaster 项目任务', icon: ClipboardList, tab: 'tasks' },
  { id: 'shell', title: '终端', subtitle: '打开项目终端', icon: Terminal, tab: 'shell' },
  { id: 'git', title: 'Git', subtitle: '查看源代码状态', icon: GitBranch, tab: 'git' },
  { id: 'dashboard', title: '数据看板', subtitle: '查看路由与成本', icon: BarChart3, tab: 'dashboard' },
  { id: 'memory', title: '记忆', subtitle: '查看知识与记忆', icon: Brain, tab: 'memory' },
  { id: 'skills', title: '技能', subtitle: '查看技能库', icon: Sparkles, tab: 'skills' },
];

function commandText(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ').toLowerCase();
}

function toSessionCard(project: Project, session: ProjectSession, unreadIds: Set<string>): HomeSessionCard {
  return {
    project,
    session,
    status: unreadIds.has(session.id) ? 'unread' : 'recent',
    lastActivityMs: getSessionTimestamp(session),
  };
}

function buildSessionCommands({
  projects,
  unreadSessions,
  onOpenSession,
}: {
  projects: Project[];
  unreadSessions: HomeSessionCard[];
  onOpenSession: (item: HomeSessionCard) => void;
}): CommandItem[] {
  const unreadIds = new Set(unreadSessions.map((item) => item.session.id));
  const allSessions = projects
    .flatMap((project) => (project.sessions ?? []).map((session) => toSessionCard(project, session, unreadIds)))
    .sort((left, right) => right.lastActivityMs - left.lastActivityMs)
    .slice(0, 24);

  const unreadCommands = unreadSessions.slice(0, 8).map((item) => ({
    id: `unread:${item.project.name}:${item.session.id}`,
    group: '未读' as const,
    title: sessionTitle(item.session),
    subtitle: `${projectName(item.project)} · ${formatHomeRelativeTime(item.lastActivityMs)}`,
    icon: Bot,
    keywords: commandText(sessionTitle(item.session), projectName(item.project), item.session.summary as string | undefined),
    run: () => onOpenSession(item),
  }));

  const sessionCommands = allSessions.map((item) => ({
    id: `session:${item.project.name}:${item.session.id}`,
    group: '会话' as const,
    title: sessionTitle(item.session),
    subtitle: `${projectName(item.project)} · ${formatHomeRelativeTime(item.lastActivityMs)}`,
    icon: Bot,
    keywords: commandText(sessionTitle(item.session), projectName(item.project), item.session.summary as string | undefined),
    run: () => onOpenSession(item),
  }));

  return [...unreadCommands, ...sessionCommands];
}

export default function CommandPalette({
  isOpen,
  projects,
  recentProjects,
  unreadSessions,
  onClose,
  onOpenHome,
  onOpenTab,
  onOpenProject,
  onOpenSession,
  onCreateProject,
  onOpenSettings,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const commands = useMemo<CommandItem[]>(() => {
    const navigation = NAV_COMMANDS.map((item) => ({
      id: `nav:${item.id}`,
      group: '操作' as const,
      title: item.title,
      subtitle: item.subtitle,
      icon: item.icon,
      keywords: commandText(item.title, item.subtitle, item.id),
      run: () => {
        if (item.tab === 'home') onOpenHome();
        else if (item.tab) onOpenTab(item.tab);
      },
    }));

    const fixedActions: CommandItem[] = [
      {
        id: 'action:create-project',
        group: '操作',
        title: '新建项目',
        subtitle: '打开项目向导',
        icon: Plus,
        keywords: commandText('新建项目', 'create project'),
        run: () => onCreateProject?.(),
      },
      {
        id: 'action:settings',
        group: '操作',
        title: '设置',
        subtitle: '打开偏好设置',
        icon: Settings,
        keywords: commandText('设置', 'settings'),
        run: onOpenSettings,
      },
    ];

    const projectPool = recentProjects.length > 0 ? recentProjects : projects;
    const projectCommands = projectPool.slice(0, 16).map((project) => ({
      id: `project:${project.name}`,
      group: '项目' as const,
      title: projectName(project),
      subtitle: `${project.sessionMeta?.total ?? project.sessions?.length ?? 0} 个会话`,
      icon: Folder,
      keywords: commandText(project.name, project.displayName, project.fullPath),
      run: () => onOpenProject(project.name),
    }));

    return [
      ...navigation,
      ...fixedActions,
      ...projectCommands,
      ...buildSessionCommands({ projects, unreadSessions, onOpenSession }),
    ];
  }, [
    onCreateProject,
    onOpenHome,
    onOpenProject,
    onOpenSession,
    onOpenSettings,
    onOpenTab,
    projects,
    recentProjects,
    unreadSessions,
  ]);

  const filteredCommands = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands.slice(0, 28);
    return commands.filter((item) => item.keywords.includes(needle) || item.title.toLowerCase().includes(needle)).slice(0, 28);
  }, [commands, query]);

  useEffect(() => {
    if (!isOpen) return undefined;
    setQuery('');
    setActiveIndex(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!isOpen || typeof document === 'undefined') return null;

  const runCommand = (item: CommandItem) => {
    item.run();
    onClose();
  };

  return createPortal(
    <div className="ui-v2 fixed inset-0 z-[70] flex items-start justify-center bg-surface-950/20 px-4 pt-20 font-sans backdrop-blur-sm dark:bg-black/40">
      <div
        aria-hidden="true"
        className="absolute inset-0 cursor-default"
        onMouseDown={onClose}
      />
      <div
        role="dialog"
        aria-label="命令面板"
        aria-modal="true"
        className="relative z-10 w-full max-w-2xl overflow-hidden rounded-xl border border-surface-200 bg-white shadow-2xl shadow-surface-900/15 dark:border-surface-800 dark:bg-surface-900 dark:shadow-black/40"
      >
        <div className="flex items-center gap-3 border-b border-surface-100 px-4 py-3 dark:border-surface-800">
          <Search className="h-5 w-5 shrink-0 text-surface-400" strokeWidth={1.75} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
                return;
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, Math.max(0, filteredCommands.length - 1)));
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((index) => Math.max(0, index - 1));
                return;
              }
              if (event.key === 'Enter' && filteredCommands[activeIndex]) {
                event.preventDefault();
                runCommand(filteredCommands[activeIndex]);
              }
            }}
            placeholder="搜索项目、会话、操作..."
            className="h-10 min-w-0 flex-1 bg-transparent text-base text-surface-900 outline-none placeholder:text-surface-400 dark:text-surface-100"
          />
        </div>

        <div className="max-h-[min(34rem,70vh)] overflow-y-auto p-2">
          {filteredCommands.length > 0 ? (
            <CommandList
              commands={filteredCommands}
              activeIndex={activeIndex}
              onHover={setActiveIndex}
              onRun={runCommand}
            />
          ) : (
            <div className="flex min-h-40 flex-col items-center justify-center px-6 py-8 text-center">
              <Search className="mb-3 h-6 w-6 text-surface-300 dark:text-surface-600" strokeWidth={1.75} />
              <p className="text-sm font-medium text-surface-600 dark:text-surface-300">没有匹配结果</p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CommandList({
  commands,
  activeIndex,
  onHover,
  onRun,
}: {
  commands: CommandItem[];
  activeIndex: number;
  onHover: (index: number) => void;
  onRun: (item: CommandItem) => void;
}) {
  let previousGroup: CommandItem['group'] | null = null;

  return (
    <div className="space-y-1">
      {commands.map((item, index) => {
        const Icon = item.icon;
        const showGroup = item.group !== previousGroup;
        previousGroup = item.group;
        return (
          <div key={item.id}>
            {showGroup ? (
              <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase text-surface-400 dark:text-surface-500">
                {item.group}
              </div>
            ) : null}
            <button
              type="button"
              onMouseEnter={() => onHover(index)}
              onClick={() => onRun(item)}
              className={
                index === activeIndex
                  ? 'flex w-full items-center gap-3 rounded-lg bg-brand-50 px-3 py-2.5 text-left dark:bg-brand-900/30'
                  : 'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-surface-50 dark:hover:bg-surface-800'
              }
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400">
                <Icon className="h-4.5 w-4.5" strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-surface-900 dark:text-surface-100">
                  {item.title}
                </span>
                <span className="mt-0.5 block truncate text-xs text-surface-500 dark:text-surface-400">
                  {item.subtitle}
                </span>
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
