import { Activity, Bot, CircleDollarSign, History, ListChecks } from 'lucide-react';
import type { HomeActivityEvent } from '../../../hooks/useHomeDashboardData';
import type { Project } from '../../../types/app';
import { projectName as displayProjectName } from './homeUtils';

type ActivityTimelineProps = {
  activities: HomeActivityEvent[];
  projects: Project[];
  onOpenProject: (projectName: string) => void;
  onShowAll: () => void;
};

const iconByType = {
  chat: Bot,
  task: ListChecks,
  cost: CircleDollarSign,
  memory: Activity,
};

export default function ActivityTimeline({
  activities,
  projects,
  onOpenProject,
  onShowAll,
}: ActivityTimelineProps) {
  return (
    <section className="animate-fade-in" style={{ animationDelay: '220ms' }}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">近期动态</h2>
        <button
          type="button"
          onClick={onShowAll}
          className="inline-flex items-center gap-1 text-sm text-brand-600 transition hover:underline dark:text-brand-400"
        >
          查看数据 <span className="text-xs">→</span>
        </button>
      </div>

      <div className="rounded-xl border border-surface-200 bg-white p-2 dark:border-surface-800 dark:bg-surface-900">
        {activities.length > 0 ? (
          <div className="divide-y divide-surface-100 dark:divide-surface-800">
            {activities.slice(0, 6).map((activity) => {
              const Icon = iconByType[activity.type] ?? History;
              const project = projects.find((item) => item.name === activity.projectName);
              const name = activity.projectDisplayName || (project ? displayProjectName(project) : activity.projectName);
              return (
                <button
                  key={activity.id}
                  type="button"
                  onClick={() => onOpenProject(activity.projectName)}
                  className="group flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition hover:bg-surface-50 dark:hover:bg-surface-800"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400">
                    <Icon className="h-4.5 w-4.5" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-surface-900 dark:text-surface-100">
                      {activity.title}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-surface-400 dark:text-surface-500">
                      {name} · {activity.detail}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-brand-600 opacity-0 transition-opacity group-hover:opacity-100 dark:text-brand-400">
                    打开
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex min-h-[180px] flex-col items-center justify-center px-4 py-8 text-center">
            <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-100 dark:bg-surface-800">
              <History className="h-5 w-5 text-surface-400" strokeWidth={1.75} />
            </span>
            <p className="text-sm text-surface-500 dark:text-surface-400">暂无近期动态</p>
            <p className="mt-1 text-xs text-surface-400 dark:text-surface-500">
              会话、Always-On 和路由事件会在这里聚合。
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
