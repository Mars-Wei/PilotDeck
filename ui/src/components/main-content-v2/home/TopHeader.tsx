import { Bell, Moon, Search, Sun } from 'lucide-react';
import { useTheme } from '../../../contexts/ThemeContext';
import BrandLogo from '../../brand/BrandLogo';

type TopHeaderProps = {
  unreadCount: number;
  onHomeClick: () => void;
};

export default function TopHeader({ unreadCount, onHomeClick }: TopHeaderProps) {
  const { isDarkMode, toggleDarkMode } = useTheme();

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
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400" strokeWidth={1.75} />
          <input
            type="text"
            placeholder="搜索项目、会话、Skills... (Cmd+K)"
            className="h-9 w-full rounded-lg border border-transparent bg-surface-100 pl-9 pr-4 text-sm text-surface-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:bg-surface-800 dark:text-surface-100"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="relative rounded-lg p-2 text-surface-600 transition hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800"
          title="通知"
        >
          <Bell className="h-5 w-5" strokeWidth={1.75} />
          {unreadCount > 0 ? (
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500" />
          ) : null}
        </button>
        <button
          type="button"
          onClick={toggleDarkMode}
          className="rounded-lg p-2 text-surface-600 transition hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800"
          title={isDarkMode ? '切换到浅色模式' : '切换到深色模式'}
        >
          {isDarkMode ? <Moon className="h-5 w-5" strokeWidth={1.75} /> : <Sun className="h-5 w-5" strokeWidth={1.75} />}
        </button>
        <div className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-900">
          <span className="text-sm font-semibold text-brand-700 dark:text-brand-300">M</span>
        </div>
      </div>
    </header>
  );
}
