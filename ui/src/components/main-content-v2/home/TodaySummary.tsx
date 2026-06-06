import { AlertTriangle, DollarSign, Inbox, ListChecks, type LucideIcon } from 'lucide-react';
import type { HomeAlertItem, HomeTaskStats } from '../../../hooks/useHomeDashboardData';
import { formatCost } from './homeUtils';

type TodaySummaryProps = {
  recentCost: number;
  recentSaved: number;
  costScope?: 'today' | 'recent';
  costFooter?: string;
  taskStats: HomeTaskStats;
  unreadCount: number;
  unreadSessionCount: number;
  alerts: HomeAlertItem[];
  onOpenDashboard: () => void;
  onOpenAlwaysOn: () => void;
  onOpenChat: () => void;
};

export default function TodaySummary({
  recentCost,
  recentSaved,
  costScope = 'recent',
  costFooter,
  taskStats,
  unreadCount,
  unreadSessionCount,
  alerts,
  onOpenDashboard,
  onOpenAlwaysOn,
  onOpenChat,
}: TodaySummaryProps) {
  const today = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <section className="animate-fade-in" style={{ animationDelay: '80ms' }}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">
          今日摘要 · <span className="text-base font-normal text-surface-400 dark:text-surface-500">{today}</span>
        </h2>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          icon={DollarSign}
          iconClassName="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
          badge="路由优化"
          value={formatCost(recentCost)}
          valueLabel={costScope === 'today' ? '/ 今日' : '/ 近期'}
          sub={recentSaved > 0 ? `节省 ${formatCost(recentSaved)} 对比不分路由` : '等待路由成本数据'}
          footer={costFooter ?? '查看数据'}
          onClick={onOpenDashboard}
        />
        <SummaryCard
          icon={ListChecks}
          iconClassName="bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
          badge={taskStats.failed > 0 ? `${taskStats.failed} 异常` : undefined}
          value={`${taskStats.completed}/${Math.max(taskStats.total, taskStats.completed)}`}
          valueLabel="已完成"
          sub={`${taskStats.running} 运行中 · ${taskStats.failed} 失败`}
          footer={`${taskStats.alwaysOnRunning} 个 Always-On 运行中`}
          onClick={onOpenAlwaysOn}
          danger={taskStats.failed > 0}
        />
        <SummaryCard
          icon={Inbox}
          iconClassName="bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400"
          badge={unreadCount > 0 ? `${unreadCount} 未读` : undefined}
          value={String(unreadCount)}
          valueLabel="条新消息"
          sub={`来自 ${unreadSessionCount} 个会话`}
          footer="打开会话"
          onClick={onOpenChat}
        />
        <SummaryCard
          icon={AlertTriangle}
          iconClassName="bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
          badge={alerts.length > 0 ? '需处理' : undefined}
          value={String(alerts.length)}
          valueLabel="项需关注"
          sub={alerts[0]?.title ?? '一切正常'}
          footer={alerts[0]?.duration ?? '暂无异常'}
          onClick={onOpenAlwaysOn}
          danger={alerts.length > 0}
        />
      </div>
    </section>
  );
}

function SummaryCard({
  icon: Icon,
  iconClassName,
  badge,
  value,
  valueLabel,
  sub,
  footer,
  onClick,
  danger = false,
}: {
  icon: LucideIcon;
  iconClassName: string;
  badge?: string;
  value: string;
  valueLabel: string;
  sub: string;
  footer: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        danger
          ? 'group rounded-xl border border-red-200 bg-white p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-red-100/30 dark:border-red-900/50 dark:bg-surface-900 dark:hover:shadow-black/20'
          : 'group rounded-xl border border-surface-200 bg-white p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-surface-200/30 dark:border-surface-800 dark:bg-surface-900 dark:hover:shadow-black/20'
      }
    >
      <div className="mb-3 flex items-center justify-between">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconClassName}`}>
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </span>
        {badge ? (
          <span className={danger ? 'rounded bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600 dark:bg-red-900/20 dark:text-red-400' : 'rounded bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-900/20 dark:text-brand-400'}>
            {badge}
          </span>
        ) : null}
      </div>
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="text-xl font-bold text-surface-900 dark:text-surface-100">{value}</span>
        <span className="text-xs text-surface-400 dark:text-surface-500">{valueLabel}</span>
      </div>
      <p className={danger ? 'mb-3 truncate text-xs text-red-600 dark:text-red-400' : 'mb-3 truncate text-xs text-surface-500 dark:text-surface-400'}>
        {sub}
      </p>
      <div className="flex items-center justify-between text-xs text-surface-400 dark:text-surface-500">
        <span className="truncate">{footer}</span>
        <span className="font-medium text-brand-600 opacity-0 transition-opacity group-hover:opacity-100 dark:text-brand-400">
          详情 →
        </span>
      </div>
    </button>
  );
}
