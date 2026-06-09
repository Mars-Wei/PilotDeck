import { useEffect, useRef, useState } from 'react';
import { Bell, Inbox, LogOut, Moon, Search, Settings, Sun } from 'lucide-react';
import { useTheme } from '../../../contexts/ThemeContext';
import { useAuth } from '../../auth/context/AuthContext';
import { DISABLE_LOCAL_AUTH } from '../../../constants/config';
import type { HomeSessionCard } from '../../../hooks/useHomeDashboardData';
import type { AppTab, Project } from '../../../types/app';
import BrandLogo from '../../brand/BrandLogo';
import { formatHomeRelativeTime } from '../../../hooks/useHomeDashboardData';
import { projectName, sessionTitle } from './homeUtils';
import CommandPalette from './CommandPalette';

type TopHeaderProps = {
  projects: Project[];
  recentProjects: Project[];
  unreadCount: number;
  unreadSessions: HomeSessionCard[];
  onHomeClick: () => void;
  onOpenTab: (tab: AppTab) => void;
  onOpenProject: (projectName: string) => void;
  onOpenSession: (item: HomeSessionCard) => void;
  onOpenChat: () => void;
  onCreateProject?: () => void;
  onOpenSettings: () => void;
};

export default function TopHeader({
  projects,
  recentProjects,
  unreadCount,
  unreadSessions,
  onHomeClick,
  onOpenTab,
  onOpenProject,
  onOpenSession,
  onOpenChat,
  onCreateProject,
  onOpenSettings,
}: TopHeaderProps) {
  const { isDarkMode, toggleDarkMode } = useTheme();
  const { user, logout } = useAuth();
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const notificationsRef = useRef<HTMLDivElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isNotificationsOpen && !isUserMenuOpen) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!notificationsRef.current?.contains(target)) {
        setIsNotificationsOpen(false);
      }
      if (!userMenuRef.current?.contains(target)) {
        setIsUserMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsNotificationsOpen(false);
        setIsUserMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isNotificationsOpen, isUserMenuOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsNotificationsOpen(false);
        setIsUserMenuOpen(false);
        setIsCommandPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const openCommandPalette = () => {
    setIsNotificationsOpen(false);
    setIsUserMenuOpen(false);
    setIsCommandPaletteOpen(true);
  };

  const openSession = (item: HomeSessionCard) => {
    onOpenSession(item);
    setIsNotificationsOpen(false);
  };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-surface-200 bg-white/80 px-4 backdrop-blur-md dark:border-surface-800 dark:bg-surface-900/80 lg:px-6">
      <button
        type="button"
        onClick={onHomeClick}
        className="flex items-center gap-3 rounded-md pr-2 text-left"
      >
        <BrandLogo />
      </button>

      <div className="hidden max-w-xl flex-1 items-center px-8 md:flex">
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={openCommandPalette}
          aria-label="打开搜索"
          className="relative h-9 w-full rounded-lg border border-transparent bg-surface-100 pl-9 pr-4 text-left text-sm text-surface-500 outline-none transition hover:bg-surface-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:bg-surface-800 dark:text-surface-400 dark:hover:bg-surface-700"
        >
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400" strokeWidth={1.75} />
          <span className="block truncate">搜索项目、会话、技能... (Cmd+K)</span>
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div ref={notificationsRef} className="relative">
          <button
            type="button"
            onClick={() => {
              setIsNotificationsOpen((open) => !open);
              setIsUserMenuOpen(false);
            }}
            className="relative rounded-lg p-2 text-surface-600 transition hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800"
            title="通知"
            aria-label="通知"
            aria-expanded={isNotificationsOpen}
            aria-haspopup="dialog"
          >
            <Bell className="h-5 w-5" strokeWidth={1.75} />
            {unreadCount > 0 ? (
              <span className="absolute right-1.5 top-1.5 flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
              </span>
            ) : null}
          </button>
          {isNotificationsOpen ? (
            <NotificationsMenu
              unreadCount={unreadCount}
              unreadSessions={unreadSessions}
              onOpenSession={openSession}
              onOpenChat={() => {
                onOpenChat();
                setIsNotificationsOpen(false);
              }}
            />
          ) : null}
        </div>
        <button
          type="button"
          onClick={toggleDarkMode}
          className="rounded-lg p-2 text-surface-600 transition hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800"
          title={isDarkMode ? '切换到浅色模式' : '切换到深色模式'}
        >
          {isDarkMode ? <Moon className="h-5 w-5" strokeWidth={1.75} /> : <Sun className="h-5 w-5" strokeWidth={1.75} />}
        </button>
        <div ref={userMenuRef} className="relative ml-1">
          <button
            type="button"
            onClick={() => {
              setIsUserMenuOpen((open) => !open);
              setIsNotificationsOpen(false);
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700 transition hover:bg-brand-200 dark:bg-brand-900 dark:text-brand-300 dark:hover:bg-brand-800"
            title="用户菜单"
            aria-label="用户菜单"
            aria-expanded={isUserMenuOpen}
            aria-haspopup="menu"
          >
            {initialForUser(user?.username)}
          </button>
          {isUserMenuOpen ? (
            <UserMenu
              username={user?.username || 'local'}
              authDisabled={DISABLE_LOCAL_AUTH || user?.username === 'local' || user?.username === 'platform-user'}
              onOpenSettings={() => {
                onOpenSettings();
                setIsUserMenuOpen(false);
              }}
              onLogout={() => {
                logout();
                setIsUserMenuOpen(false);
              }}
            />
          ) : null}
        </div>
      </div>
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        projects={projects}
        recentProjects={recentProjects}
        unreadSessions={unreadSessions}
        onClose={() => setIsCommandPaletteOpen(false)}
        onOpenHome={onHomeClick}
        onOpenTab={onOpenTab}
        onOpenProject={onOpenProject}
        onOpenSession={onOpenSession}
        onCreateProject={onCreateProject}
        onOpenSettings={onOpenSettings}
      />
    </header>
  );
}

function initialForUser(username?: string | null): string {
  const value = (username || 'M').trim();
  return value.charAt(0).toUpperCase() || 'M';
}

function NotificationsMenu({
  unreadCount,
  unreadSessions,
  onOpenSession,
  onOpenChat,
}: {
  unreadCount: number;
  unreadSessions: HomeSessionCard[];
  onOpenSession: (item: HomeSessionCard) => void;
  onOpenChat: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label="通知中心"
      className="absolute right-0 top-11 z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-surface-200 bg-white shadow-xl shadow-surface-900/10 dark:border-surface-800 dark:bg-surface-900 dark:shadow-black/30"
    >
      <div className="flex items-center justify-between border-b border-surface-100 px-4 py-3 dark:border-surface-800">
        <div>
          <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">通知中心</h2>
          <p className="mt-0.5 text-xs text-surface-400 dark:text-surface-500">
            {unreadCount > 0 ? `${unreadCount} 条未读消息` : '当前没有未读消息'}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenChat}
          className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 transition hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-900/30"
        >
          打开会话
        </button>
      </div>

      {unreadSessions.length > 0 ? (
        <div className="max-h-80 overflow-y-auto p-2">
          {unreadSessions.slice(0, 8).map((item) => (
            <button
              key={`${item.project.name}:${item.session.id}`}
              type="button"
              onClick={() => onOpenSession(item)}
              className="group flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition hover:bg-surface-50 dark:hover:bg-surface-800"
            >
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-500" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-surface-900 dark:text-surface-100">
                  {sessionTitle(item.session)}
                </span>
                <span className="mt-0.5 block truncate text-xs text-surface-500 dark:text-surface-400">
                  {projectName(item.project)} · {formatHomeRelativeTime(item.lastActivityMs)}
                </span>
                {item.session.summary ? (
                  <span className="mt-1 block line-clamp-2 text-xs text-surface-400 dark:text-surface-500">
                    {String(item.session.summary)}
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 shrink-0 text-xs font-medium text-brand-600 opacity-0 transition-opacity group-hover:opacity-100 dark:text-brand-400">
                查看
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex min-h-44 flex-col items-center justify-center px-6 py-8 text-center">
          <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-100 text-surface-400 dark:bg-surface-800">
            <Inbox className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <p className="text-sm font-medium text-surface-600 dark:text-surface-300">没有新的通知</p>
          <p className="mt-1 text-xs text-surface-400 dark:text-surface-500">
            新消息和需要处理的会话会出现在这里。
          </p>
        </div>
      )}
    </div>
  );
}

function UserMenu({
  username,
  authDisabled,
  onOpenSettings,
  onLogout,
}: {
  username: string;
  authDisabled: boolean;
  onOpenSettings: () => void;
  onLogout: () => void;
}) {
  return (
    <div
      role="menu"
      aria-label="用户菜单"
      className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-xl border border-surface-200 bg-white shadow-xl shadow-surface-900/10 dark:border-surface-800 dark:bg-surface-900 dark:shadow-black/30"
    >
      <div className="border-b border-surface-100 px-4 py-3 dark:border-surface-800">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700 dark:bg-brand-900 dark:text-brand-300">
            {initialForUser(username)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-surface-900 dark:text-surface-100">
              {username}
            </span>
            <span className="mt-0.5 block truncate text-xs text-surface-400 dark:text-surface-500">
              {authDisabled ? '本地模式' : '已登录'}
            </span>
          </span>
        </div>
      </div>
      <div className="p-2">
        <button
          type="button"
          role="menuitem"
          onClick={onOpenSettings}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-surface-700 transition hover:bg-surface-50 dark:text-surface-200 dark:hover:bg-surface-800"
        >
          <Settings className="h-4 w-4 text-surface-400" strokeWidth={1.75} />
          设置
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={onLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-surface-700 transition hover:bg-surface-50 dark:text-surface-200 dark:hover:bg-surface-800"
        >
          <LogOut className="h-4 w-4 text-surface-400" strokeWidth={1.75} />
          {authDisabled ? '重置本地会话' : '退出登录'}
        </button>
      </div>
    </div>
  );
}
