import {
  BarChart3,
  Brain,
  FolderOpen,
  Home,
  KeyRound,
  MessageSquare,
  Puzzle,
  Settings,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { AppTab } from '../../../types/app';

export type HomeNavId = AppTab;

type MenuItem = {
  id: HomeNavId;
  label: string;
  icon: LucideIcon;
  badge?: string;
};

type HomeSidebarProps = {
  activeId: HomeNavId;
  unreadCount: number;
  runningCount: number;
  onTabClick: (tab: HomeNavId) => void;
  onOpenSettings: () => void;
  onOpenApiKeys: () => void;
};

export default function HomeSidebar({
  activeId,
  unreadCount,
  runningCount,
  onTabClick,
  onOpenSettings,
  onOpenApiKeys,
}: HomeSidebarProps) {
  const menuItems: MenuItem[] = [
    { id: 'home', label: '首页', icon: Home },
    { id: 'sessions', label: '会话', icon: MessageSquare, badge: unreadCount > 0 ? String(unreadCount) : undefined },
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
          const isActive = item.id === activeId;
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

      {/* Quick actions (moved here from the right status panel). */}
      <div className="space-y-1 border-t border-surface-200 px-2 py-3 dark:border-surface-800 lg:px-3">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-surface-600 transition hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800"
        >
          <Settings className="h-5 w-5 shrink-0" strokeWidth={1.75} />
          <span className="hidden text-sm lg:block">设置</span>
        </button>
        <button
          type="button"
          onClick={onOpenApiKeys}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-surface-600 transition hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800"
        >
          <KeyRound className="h-5 w-5 shrink-0" strokeWidth={1.75} />
          <span className="hidden text-sm lg:block">API 密钥</span>
        </button>
        {runningCount > 0 ? (
          <button
            type="button"
            onClick={onOpenSettings}
            className="mt-1 hidden w-full rounded-lg bg-amber-50 px-3 py-2 text-left text-xs font-medium text-amber-700 transition hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/15 lg:block"
          >
            {runningCount} 个任务运行中
          </button>
        ) : null}
      </div>
    </nav>
  );
}
