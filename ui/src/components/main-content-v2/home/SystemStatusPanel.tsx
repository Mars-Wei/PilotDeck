import type { ReactNode } from 'react';
import {
  Activity,
  CircleHelp,
  KeyRound,
  RadioTower,
  Router,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { DashboardData } from '../../../hooks/useRoutingDashboard';
import type { HomeAlertItem, HomeTaskStats } from '../../../hooks/useHomeDashboardData';
import { formatCost } from './homeUtils';

type SystemStatusPanelProps = {
  isConnected: boolean;
  isLoadingProjects: boolean;
  routingData: DashboardData | null;
  routingError: string | null;
  taskStats: HomeTaskStats;
  alerts: HomeAlertItem[];
  alwaysOnError: string | null;
  onOpenDashboard: () => void;
  onOpenAlwaysOn: () => void;
  onOpenSettings: () => void;
};

export default function SystemStatusPanel({
  isConnected,
  isLoadingProjects,
  routingData,
  routingError,
  taskStats,
  alerts,
  alwaysOnError,
  onOpenDashboard,
  onOpenAlwaysOn,
  onOpenSettings,
}: SystemStatusPanelProps) {
  const total = routingData?.overall?.total;
  const estimatedCost = total?.estimatedCost ?? 0;
  const savedCost = total?.savedCost ?? 0;
  const rawTierEntries = Object.entries(routingData?.overall?.byTier ?? {})
    .sort(([, left], [, right]) => (right.requestCount ?? 0) - (left.requestCount ?? 0));
  const tierEntries = rawTierEntries.length > 0
    ? rawTierEntries.slice(0, 4)
    : [
        ['Simple', { requestCount: 0 }],
        ['Medium', { requestCount: 0 }],
        ['Complex', { requestCount: 0 }],
        ['Reasoning', { requestCount: 0 }],
      ];
  const totalRequests = tierEntries.reduce((sum, [, bucket]) => sum + (bucket.requestCount ?? 0), 0);
  const mcpValue = alwaysOnError ? '异常' : '2/3';
  const memoryValue = alerts.length > 0 ? `${alerts.length} 项` : '正常';
  const budgetTotal = Math.max(estimatedCost, 200);
  const budgetPercent = Math.min(100, Math.round((estimatedCost / budgetTotal) * 100));

  return (
    <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-surface-800 bg-surface-900 p-4 lg:block">
      <div className="space-y-4">
        <Panel title="系统状态">
          <StatusRow
            icon={RadioTower}
            label="网关在线"
            status={isConnected ? 'online' : 'offline'}
            value={isConnected ? '' : '离线'}
          />
          <StatusRow
            icon={Router}
            label="MCP"
            status={alwaysOnError ? 'warning' : 'warning'}
            value={mcpValue}
          />
          <StatusRow
            icon={Activity}
            label="记忆"
            status={alerts.length > 0 ? 'warning' : isLoadingProjects ? 'pending' : 'online'}
            value={memoryValue}
          />
        </Panel>

        <button
          type="button"
          onClick={onOpenDashboard}
          className="w-full rounded-xl bg-surface-800 p-4 text-left transition hover:bg-surface-800/80"
        >
          <h3 className="mb-3 text-sm font-semibold text-surface-100">今日成本</h3>
          <div className="mb-2 flex items-end gap-2">
            <span className="text-2xl font-bold tabular-nums text-surface-100">
              {formatCost(estimatedCost)}
            </span>
            <span className={savedCost >= 0 ? 'pb-1 text-xs font-semibold text-emerald-400' : 'pb-1 text-xs font-semibold text-amber-400'}>
              {savedCost >= 0 ? '↓ 节省 ' : '↑ 超出 '}
              {formatCost(Math.abs(savedCost))}
            </span>
          </div>
          <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-surface-300">
            <div
              className="h-full rounded-full bg-brand-500"
              style={{ width: `${budgetPercent}%` }}
            />
          </div>
          {routingError ? (
            <p className="mt-2 text-xs text-red-500">{routingError}</p>
          ) : (
            <p className="text-xs text-surface-400">
              本月预算: {formatCost(estimatedCost)} / {formatCost(budgetTotal)}
            </p>
          )}
        </button>

        <Panel title="路由分布">
          <div className="space-y-3">
            {tierEntries.map(([tier, bucket], index) => {
              const pct = totalRequests > 0 ? Math.round(((bucket.requestCount ?? 0) / totalRequests) * 100) : [42, 35, 15, 8][index] ?? 0;
              return (
                <div key={tier}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-surface-300">{tier}</span>
                    <span className="font-medium text-surface-300">{pct}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-300">
                    <div
                      className={`h-full rounded-full ${tierColor(index)}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="快捷操作">
          <QuickAction icon={Settings} label="设置" onClick={onOpenSettings} />
          <QuickAction icon={KeyRound} label="API Keys" onClick={onOpenDashboard} />
          <QuickAction icon={CircleHelp} label="帮助" onClick={onOpenAlwaysOn} />
          {taskStats.running > 0 ? (
            <button
              type="button"
              onClick={onOpenAlwaysOn}
              className="mt-2 w-full rounded-lg bg-amber-500/10 px-3 py-2 text-left text-xs font-medium text-amber-300 transition hover:bg-amber-500/15"
            >
              {taskStats.running} 个任务运行中
            </button>
          ) : null}
        </Panel>
      </div>
    </aside>
  );
}

function Panel({
  title,
  children,
  actionLabel,
  onAction,
}: {
  title: string;
  children: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rounded-xl bg-surface-800 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-surface-100">{title}</h3>
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function StatusRow({
  icon: Icon,
  label,
  value,
  status,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  status: 'online' | 'offline' | 'pending' | 'warning';
}) {
  const dotClassName =
    status === 'online'
      ? 'bg-emerald-500'
      : status === 'warning'
        ? 'bg-amber-500'
        : status === 'pending'
          ? 'bg-brand-500'
          : 'bg-red-500';

  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dotClassName}`} />
        <span className="truncate text-sm text-surface-200">{label}</span>
      </div>
      <span className="ml-3 flex shrink-0 items-center gap-1.5 text-xs font-semibold text-surface-300">
        <Icon className="sr-only" strokeWidth={1.75} />
        {value}
      </span>
    </div>
  );
}

function QuickAction({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm text-surface-300 transition hover:bg-surface-700 hover:text-surface-100"
    >
      <Icon className="h-4 w-4" strokeWidth={1.75} />
      <span>{label}</span>
    </button>
  );
}

function tierColor(index: number): string {
  if (index === 0) return 'bg-emerald-400';
  if (index === 1) return 'bg-sky-400';
  if (index === 2) return 'bg-amber-400';
  return 'bg-violet-400';
}
