import {
  BarChart3,
  Brain,
  FolderOpen,
  Home,
  MessageSquare,
  Puzzle,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { AppTab, Project } from '../../../types/app';
import { projectName } from './homeUtils';

export type HomeNavId = AppTab | 'projects';

type MenuItem = {
  id: HomeNavId;
  label: string;
  icon: LucideIcon;
  badge?: string;
};

type HomeSidebarProps = {
  projects: Project[];
  unreadCount: number;
  runningCount: number;
  onTabClick: (tab: HomeNavId) => void;
  onProjectClick: (projectName: string) => void;
};

export default function HomeSidebar({
  projects,
  unreadCount,
  runningCount,
  onTabClick,
  onProjectClick,
}: HomeSidebarProps) {
  const menuItems: MenuItem[] = [
    { id: 'home', label: '首页', icon: Home },
    { id: 'chat', label: '会话', icon: MessageSquare, badge: unreadCount > 0 ? String(unreadCount) : undefined },
    { id: 'projects', label: '项目', icon: FolderOpen },
    { id: 'always-on', label: '任务', icon: Zap, badge: runningCount > 0 ? `${runningCount} 运行中` : undefined },
    { id: 'memory', label: '记忆', icon: Brain },
    { id: 'skills', label: '插件', icon: Puzzle },
    { id: 'dashboard', label: '数据', icon: BarChart3 },
  ];

  return (
    <nav className="flex h-full w-16 shrink-0 flex-col border-r border-surface-200 bg-white dark:border-surface-800 dark:bg-surface-900 lg:w-56">
      <div className="flex-1 space-y-1 px-2 py-4 lg:px-3">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === 'home';
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabClick(item.id)}
              className={
                isActive
                  ? 'flex w-full items-center gap-3 rounded-lg bg-brand-50 px-3 py-2.5 text-left font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                  : 'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-surface-600 transition hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800'
              }
            >
              <Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} />
              <span className="hidden text-sm lg:block">{item.label}</span>
              {item.badge ? (
                <span className="ml-auto hidden rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white lg:inline-flex">
                  {item.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {projects.length > 0 ? (
        <div className="border-t border-surface-200 px-2 py-3 dark:border-surface-800 lg:px-3">
          <div className="mb-2 hidden px-3 text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 lg:block">
            最近项目
          </div>
          <div className="space-y-1">
            {projects.slice(0, 3).map((project, index) => (
              <button
                key={project.name}
                type="button"
                onClick={() => onProjectClick(project.name)}
                className="flex w-full items-center gap-2 truncate rounded-lg px-3 py-1.5 text-left text-surface-500 transition hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800"
              >
                <span
                  className={
                    index === 0
                      ? 'h-2 w-2 shrink-0 rounded-full bg-emerald-500'
                      : index === 1
                        ? 'h-2 w-2 shrink-0 rounded-full bg-amber-500'
                        : 'h-2 w-2 shrink-0 rounded-full bg-sky-500'
                  }
                />
                <span className="hidden truncate text-xs lg:block">{projectName(project)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </nav>
  );
}
