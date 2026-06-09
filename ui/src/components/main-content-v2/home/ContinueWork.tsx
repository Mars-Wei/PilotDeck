import { Radio } from 'lucide-react';
import type { HomeSessionCard } from '../../../hooks/useHomeDashboardData';
import { formatHomeRelativeTime } from '../../../hooks/useHomeDashboardData';
import { projectName, sessionTitle } from './homeUtils';

type ContinueWorkProps = {
  sessions: HomeSessionCard[];
  onEnterSession: (item: HomeSessionCard) => void;
  onShowAll: () => void;
};

export default function ContinueWork({ sessions, onEnterSession, onShowAll }: ContinueWorkProps) {
  return (
    <section className="animate-fade-in" style={{ animationDelay: '120ms' }}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">继续工作</h2>
        <button
          type="button"
          onClick={onShowAll}
          className="inline-flex items-center gap-1 text-sm text-brand-600 transition hover:underline dark:text-brand-400"
        >
          查看全部 <span className="text-xs">→</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {sessions.length > 0 ? (
          sessions.slice(0, 3).map((item) => (
            <button
              key={`${item.project.name}:${item.session.id}`}
              type="button"
              onClick={() => onEnterSession(item)}
              className="group rounded-xl border border-surface-200 bg-white p-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-surface-200/30 dark:border-surface-800 dark:bg-surface-900 dark:hover:shadow-black/20"
            >
              <div className="mb-3 flex items-start justify-between">
                <div className="flex items-center gap-2">
                  {item.status === 'running' ? (
                    <span className="relative flex h-3 w-3">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
                    </span>
                  ) : item.status === 'unread' ? (
                    <span className="h-3 w-3 rounded-full bg-brand-500" />
                  ) : (
                    <Radio className="h-3.5 w-3.5 text-surface-400" strokeWidth={1.75} />
                  )}
                  <span className={item.status === 'running' ? 'text-xs font-medium text-red-600 dark:text-red-400' : item.status === 'unread' ? 'text-xs font-medium text-brand-600 dark:text-brand-400' : 'text-xs font-medium text-surface-500 dark:text-surface-400'}>
                    {item.status === 'running' ? '直播中' : item.status === 'unread' ? '未读' : '最近'}
                  </span>
                </div>
                <span className="text-xs text-surface-400 dark:text-surface-500">
                  {formatHomeRelativeTime(item.lastActivityMs)}
                </span>
              </div>
              <h3 className="mb-1 truncate font-semibold text-surface-900 dark:text-surface-100">
                {sessionTitle(item.session)}
              </h3>
              <p className="mb-4 truncate text-xs text-surface-400 dark:text-surface-500">
                {projectName(item.project)}
              </p>
              <p className="mb-4 line-clamp-2 min-h-10 text-sm text-surface-500 dark:text-surface-400">
                {item.session.summary || item.session.title || '打开会话继续处理上下文。'}
              </p>
              <span className="block rounded-lg bg-brand-50 py-2 text-center text-sm font-medium text-brand-700 transition group-hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-300 dark:group-hover:bg-brand-900/50">
                进入会话
              </span>
            </button>
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-surface-300 bg-surface-50 p-8 text-center dark:border-surface-700 dark:bg-surface-800/50 md:col-span-3">
            <p className="text-sm text-surface-400 dark:text-surface-500">暂无可继续的会话</p>
            <p className="mt-1 text-xs text-surface-400 dark:text-surface-500">开始一个新会话后，这里会自动出现。</p>
          </div>
        )}
      </div>
    </section>
  );
}
