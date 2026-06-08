import { useMemo, useState } from 'react';
import {
  Database,
  FolderOpen,
  Globe,
  Plus,
  Search,
  Smartphone,
} from 'lucide-react';
import type { Project } from '../../types/app';
import { formatShortDate, getSessionTimestamp, projectName } from './home/homeUtils';

type ProjectsV2Props = {
  projects: Project[];
  selectedProject: Project | null;
  onSelectProject: (projectName: string) => void;
  onCreateProject?: () => void;
};

function countSessions(project: Project): number {
  return typeof project.sessionMeta?.total === 'number'
    ? project.sessionMeta.total
    : project.sessions?.length ?? 0;
}

function getProjectTimestamp(project: Project): number {
  const latestSession = [...(project.sessions ?? [])].sort(
    (left, right) => getSessionTimestamp(right) - getSessionTimestamp(left),
  )[0];
  const projectLastActivity =
    typeof project.lastActivity === 'number'
      ? project.lastActivity
      : Date.parse(String(project.lastActivity || ''));
  return Math.max(
    Number.isFinite(projectLastActivity) ? projectLastActivity : 0,
    latestSession ? getSessionTimestamp(latestSession) : 0,
  );
}

function pickProjectIcon(name: string) {
  if (name.includes('数据')) {
    return {
      Icon: Database,
      tone: 'bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400',
    };
  }
  if (name.includes('小程序')) {
    return {
      Icon: Smartphone,
      tone: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
    };
  }
  return {
    Icon: Globe,
    tone: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
  };
}

export default function ProjectsV2({
  projects,
  selectedProject,
  onSelectProject,
  onCreateProject,
}: ProjectsV2Props) {
  const [query, setQuery] = useState('');
  const sortedProjects = useMemo(
    () => [...projects].sort((left, right) => getProjectTimestamp(right) - getProjectTimestamp(left)),
    [projects],
  );
  const filteredProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sortedProjects;
    return sortedProjects.filter((project) =>
      [
        project.name,
        project.displayName,
        project.fullPath,
        project.path,
        projectName(project),
      ].filter(Boolean).join(' ').toLowerCase().includes(needle),
    );
  }, [query, sortedProjects]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-surface-900 dark:bg-surface-900 dark:text-surface-100">
      <div className="shrink-0 border-b border-surface-100 px-4 py-4 dark:border-surface-800 lg:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid grid-cols-2 gap-2 text-sm sm:w-72">
            <StatBox label="项目" value={String(projects.length)} />
            <StatBox label="会话" value={String(projects.reduce((total, project) => total + countSessions(project), 0))} />
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative min-w-0 flex-1 sm:w-80 sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400" strokeWidth={1.75} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索项目"
                className="h-9 w-full rounded-lg border border-surface-200 bg-surface-50 pl-9 pr-3 text-sm outline-none transition focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/15 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100 dark:focus:border-brand-500 dark:focus:bg-surface-900"
              />
            </label>
            <button
              type="button"
              onClick={onCreateProject}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white transition hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-400"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              新建项目
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-5">
        {filteredProjects.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filteredProjects.map((project) => (
              <ProjectCard
                key={project.name}
                project={project}
                active={selectedProject?.name === project.name}
                onClick={() => onSelectProject(project.name)}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full min-h-[280px] flex-col items-center justify-center px-6 text-center">
            <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-surface-100 text-surface-400 dark:bg-surface-800">
              <FolderOpen className="h-6 w-6" strokeWidth={1.75} />
            </span>
            <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">
              {query ? '没有匹配的项目' : '暂无项目'}
            </h2>
            <p className="mt-1 max-w-sm text-sm text-surface-500 dark:text-surface-400">
              {query ? '换一个关键词后再试。' : '新建或导入项目后，这里会显示完整项目列表。'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  active,
  onClick,
}: {
  project: Project;
  active: boolean;
  onClick: () => void;
}) {
  const name = projectName(project);
  const { Icon, tone } = pickProjectIcon(name);
  const sessionCount = countSessions(project);
  const lastActivity = getProjectTimestamp(project);
  const path = String(project.fullPath || project.path || '');

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'group rounded-xl border border-brand-200 bg-brand-50/80 p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-brand-100/30 dark:border-brand-900/50 dark:bg-brand-900/20 dark:hover:shadow-black/20'
          : 'group rounded-xl border border-surface-200 bg-white p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-surface-200/30 dark:border-surface-800 dark:bg-surface-900 dark:hover:shadow-black/20'
      }
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tone}`}>
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <span className="rounded-full bg-surface-100 px-2 py-0.5 text-xs text-surface-500 dark:bg-surface-800 dark:text-surface-400">
          {sessionCount} 个会话
        </span>
      </div>
      <h3 className="truncate text-sm font-semibold text-surface-900 dark:text-surface-100">{name}</h3>
      <p className="mt-1 truncate text-xs text-surface-400 dark:text-surface-500">{path || project.name}</p>
      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-surface-400 dark:text-surface-500">
        <span>最近: {formatShortDate(lastActivity)}</span>
        <span className="font-medium text-brand-600 opacity-0 transition-opacity group-hover:opacity-100 dark:text-brand-400">
          打开 →
        </span>
      </div>
    </button>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 dark:border-surface-700 dark:bg-surface-800">
      <div className="text-base font-semibold text-surface-900 dark:text-surface-100">{value}</div>
      <div className="mt-0.5 text-xs text-surface-500 dark:text-surface-400">{label}</div>
    </div>
  );
}
