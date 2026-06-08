import { useMemo, useState } from 'react';
import {
  Circle,
  Clock3,
  FolderOpen,
  MessageSquare,
  Plus,
  Radio,
  Search,
} from 'lucide-react';
import type { Project, ProjectSession } from '../../types/app';
import { cn } from '../../lib/utils.js';
import { formatHomeRelativeTime } from '../../hooks/useHomeDashboardData';
import { getSessionTimestamp, projectName, sessionTitle } from './home/homeUtils';

type SessionsV2Props = {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  unreadSessionIds: Set<string>;
  processingSessions: Set<string>;
  onSelectProjectByName?: (projectName: string) => void;
  onSelectSession?: (project: Project, sessionId: string, fallbackSession?: ProjectSession) => void;
  onStartNewSession: (project: Project) => void;
  onCreateProject?: () => void;
};

type SessionRow = {
  project: Project;
  session: ProjectSession;
  lastActivityMs: number;
};

function flattenSessions(projects: Project[]): SessionRow[] {
  return projects
    .flatMap((project) =>
      (project.sessions ?? []).map((session) => ({
        project,
        session,
        lastActivityMs: getSessionTimestamp(session),
      })),
    )
    .sort((left, right) => right.lastActivityMs - left.lastActivityMs);
}

function countSessions(project: Project): number {
  return typeof project.sessionMeta?.total === 'number'
    ? project.sessionMeta.total
    : project.sessions?.length ?? 0;
}

function pickDefaultProject(projects: Project[], selectedProject: Project | null): Project | null {
  if (selectedProject) return selectedProject;
  return projects.find((project) => project.name === 'general' || project.displayName === 'general') ?? projects[0] ?? null;
}

function statusForSession(
  sessionId: string,
  unreadSessionIds: Set<string>,
  processingSessions: Set<string>,
): { label: string; tone: 'running' | 'unread' | 'idle' } {
  if (processingSessions.has(sessionId)) return { label: '运行中', tone: 'running' };
  if (unreadSessionIds.has(sessionId)) return { label: '未读', tone: 'unread' };
  return { label: '最近', tone: 'idle' };
}

export default function SessionsV2({
  projects,
  selectedProject,
  selectedSession,
  unreadSessionIds,
  processingSessions,
  onSelectProjectByName,
  onSelectSession,
  onStartNewSession,
  onCreateProject,
}: SessionsV2Props) {
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const defaultProject = useMemo(() => pickDefaultProject(projects, selectedProject), [projects, selectedProject]);
  const allSessions = useMemo(() => flattenSessions(projects), [projects]);
  const loadedSessionCount = allSessions.length;
  const totalSessionCount = useMemo(
    () => projects.reduce((total, project) => total + countSessions(project), 0),
    [projects],
  );
  const hasUnloadedSessions = totalSessionCount > loadedSessionCount;

  const filteredSessions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allSessions.filter(({ project, session }) => {
      if (projectFilter !== 'all' && project.name !== projectFilter) return false;
      if (!needle) return true;
      const haystack = [
        sessionTitle(session),
        String(session.summary || ''),
        projectName(project),
        project.name,
      ].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [allSessions, projectFilter, query]);

  const unreadCount = unreadSessionIds.size;
  const runningCount = Array.from(processingSessions).length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-surface-900 dark:bg-surface-900 dark:text-surface-100">
      <div className="shrink-0 border-b border-surface-100 px-4 py-4 dark:border-surface-800 lg:px-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="grid grid-cols-3 gap-2 text-sm xl:w-[26rem]">
            <StatPill label="已加载" value={String(loadedSessionCount)} />
            <StatPill label="未读" value={String(unreadCount)} tone="brand" />
            <StatPill label="运行中" value={String(runningCount)} tone="red" />
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400" strokeWidth={1.75} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索会话或项目"
                className="h-9 w-full rounded-lg border border-surface-200 bg-surface-50 pl-9 pr-3 text-sm outline-none transition focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/15 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100 dark:focus:border-brand-500 dark:focus:bg-surface-900"
              />
            </label>
            <select
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
              className="h-9 rounded-lg border border-surface-200 bg-surface-50 px-3 text-sm text-surface-700 outline-none transition focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/15 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-200 dark:focus:border-brand-500 dark:focus:bg-surface-900"
            >
              <option value="all">全部项目</option>
              {projects.map((project) => (
                <option key={project.name} value={project.name}>
                  {projectName(project)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                if (defaultProject) onStartNewSession(defaultProject);
                else onCreateProject?.();
              }}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white transition hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-400"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              新建会话
            </button>
          </div>
        </div>
        {hasUnloadedSessions ? (
          <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
            当前列表显示已加载的 {loadedSessionCount} 个会话，仍有 {totalSessionCount - loadedSessionCount} 个历史会话未加载。
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filteredSessions.length > 0 ? (
          <div className="divide-y divide-surface-100 dark:divide-surface-800">
            {filteredSessions.map(({ project, session, lastActivityMs }) => {
              const status = statusForSession(session.id, unreadSessionIds, processingSessions);
              const isActive = selectedProject?.name === project.name && selectedSession?.id === session.id;
              return (
                <button
                  key={`${project.name}:${session.id}`}
                  type="button"
                  onClick={() => onSelectSession?.(project, session.id, session)}
                  className={cn(
                    'group flex w-full items-start gap-3 px-4 py-4 text-left transition lg:px-5',
                    isActive
                      ? 'bg-brand-50/80 dark:bg-brand-900/20'
                      : 'hover:bg-surface-50 dark:hover:bg-surface-800/70',
                  )}
                >
                  <span
                    className={cn(
                      'mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                      status.tone === 'running' && 'bg-red-50 text-red-600 dark:bg-red-900/25 dark:text-red-300',
                      status.tone === 'unread' && 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300',
                      status.tone === 'idle' && 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400',
                    )}
                  >
                    {status.tone === 'running' ? (
                      <Radio className="h-4 w-4" strokeWidth={1.75} />
                    ) : status.tone === 'unread' ? (
                      <MessageSquare className="h-4 w-4" strokeWidth={1.75} />
                    ) : (
                      <Circle className="h-3.5 w-3.5" strokeWidth={2} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <span className="min-w-0 truncate text-sm font-semibold text-surface-900 dark:text-surface-100">
                        {sessionTitle(session)}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-xs text-surface-400 dark:text-surface-500">
                        <Clock3 className="h-3.5 w-3.5" strokeWidth={1.75} />
                        {formatHomeRelativeTime(lastActivityMs)}
                      </span>
                    </span>
                    <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-surface-500 dark:text-surface-400">
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <FolderOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                        <span className="truncate">{projectName(project)}</span>
                      </span>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                          status.tone === 'running' && 'bg-red-50 text-red-600 dark:bg-red-900/25 dark:text-red-300',
                          status.tone === 'unread' && 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300',
                          status.tone === 'idle' && 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400',
                        )}
                      >
                        {status.label}
                      </span>
                      {typeof session.messageCount === 'number' ? (
                        <span>{session.messageCount} 条消息</span>
                      ) : null}
                    </span>
                    <span className="mt-2 block line-clamp-2 text-sm text-surface-500 dark:text-surface-400">
                      {String(session.summary || session.title || '打开会话继续处理上下文。')}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex h-full min-h-[280px] flex-col items-center justify-center px-6 text-center">
            <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-surface-100 text-surface-400 dark:bg-surface-800">
              <MessageSquare className="h-6 w-6" strokeWidth={1.75} />
            </span>
            <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">
              {query || projectFilter !== 'all' ? '没有匹配的会话' : '暂无会话'}
            </h2>
            <p className="mt-1 max-w-sm text-sm text-surface-500 dark:text-surface-400">
              {query || projectFilter !== 'all'
                ? '换一个关键词或项目筛选条件后再试。'
                : '开始新会话后，这里会显示所有项目的会话列表。'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatPill({
  label,
  value,
  tone = 'surface',
}: {
  label: string;
  value: string;
  tone?: 'surface' | 'brand' | 'red';
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2',
        tone === 'surface' && 'border-surface-200 bg-surface-50 dark:border-surface-700 dark:bg-surface-800',
        tone === 'brand' && 'border-brand-100 bg-brand-50 dark:border-brand-900/50 dark:bg-brand-900/20',
        tone === 'red' && 'border-red-100 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20',
      )}
    >
      <div
        className={cn(
          'text-base font-semibold',
          tone === 'surface' && 'text-surface-900 dark:text-surface-100',
          tone === 'brand' && 'text-brand-700 dark:text-brand-300',
          tone === 'red' && 'text-red-600 dark:text-red-300',
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-surface-500 dark:text-surface-400">{label}</div>
    </div>
  );
}
