import { Database, Globe, Plus, Smartphone } from 'lucide-react';
import type { Project } from '../../../types/app';
import { formatShortDate, getSessionTimestamp, projectName } from './homeUtils';

type ProjectsOverviewProps = {
  projects: Project[];
  onSelectProject: (projectName: string) => void;
  onCreateProject: () => void;
};

export default function ProjectsOverview({
  projects,
  onSelectProject,
  onCreateProject,
}: ProjectsOverviewProps) {
  return (
    <section className="animate-fade-in" style={{ animationDelay: '180ms' }}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">我的项目</h2>
        <button
          type="button"
          onClick={onCreateProject}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 transition hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-300 dark:hover:bg-brand-900/50"
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          新建项目
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {projects.slice(0, 7).map((project) => (
          <ProjectCard key={project.name} project={project} onClick={() => onSelectProject(project.name)} />
        ))}
        <button
          type="button"
          onClick={onCreateProject}
          className="flex min-h-[140px] flex-col items-center justify-center rounded-xl border border-dashed border-surface-300 bg-surface-50 p-4 text-center transition hover:border-surface-400 hover:bg-white dark:border-surface-700 dark:bg-surface-800/50 dark:hover:border-surface-600 dark:hover:bg-surface-800"
        >
          <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-100 dark:bg-surface-800">
            <Plus className="h-5 w-5 text-surface-400" strokeWidth={1.75} />
          </span>
          <span className="text-sm font-medium text-surface-400 dark:text-surface-500">新建项目</span>
        </button>
      </div>
    </section>
  );
}

function ProjectCard({ project, onClick }: { project: Project; onClick: () => void }) {
  const name = projectName(project);
  const sessionCount =
    typeof project.sessionMeta?.total === 'number'
      ? project.sessionMeta.total
      : project.sessions?.length ?? 0;
  const latestSession = [...(project.sessions ?? [])].sort(
    (left, right) => getSessionTimestamp(right) - getSessionTimestamp(left),
  )[0];
  const projectLastActivity =
    typeof project.lastActivity === 'number'
      ? project.lastActivity
      : Date.parse(String(project.lastActivity || ''));
  const lastActivity = Math.max(
    Number.isFinite(projectLastActivity) ? projectLastActivity : 0,
    latestSession ? getSessionTimestamp(latestSession) : 0,
  );

  const iconTone = name.includes('数据')
    ? 'bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400'
    : name.includes('小程序')
      ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
      : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400';
  const Icon = name.includes('数据') ? Database : name.includes('小程序') ? Smartphone : Globe;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-xl border border-surface-200 bg-white p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-surface-200/30 dark:border-surface-800 dark:bg-surface-900 dark:hover:shadow-black/20"
    >
      <span className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg ${iconTone}`}>
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <h3 className="mb-0.5 truncate text-sm font-semibold text-surface-900 dark:text-surface-100">{name}</h3>
      <p className="mb-2 text-xs text-surface-400 dark:text-surface-500">{sessionCount} 个会话</p>
      <p className="text-xs text-surface-400 dark:text-surface-500">最近: {formatShortDate(lastActivity)}</p>
      <div className="mt-3 opacity-0 transition-opacity group-hover:opacity-100">
        <span className="text-xs font-medium text-brand-600 dark:text-brand-400">打开 →</span>
      </div>
    </button>
  );
}
