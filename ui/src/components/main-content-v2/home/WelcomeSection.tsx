import { useMemo, useState } from 'react';
import { ArrowRight, FileUp, FolderOpen, Plus, Zap, type LucideIcon } from 'lucide-react';
import type { Project } from '../../../types/app';

type WelcomeSectionProps = {
  projects: Project[];
  onNewSession: () => void;
  onOpenProject: () => void;
  onNewTask: () => void;
  onImportDoc: () => void;
  onQuickSubmit: (text: string) => void;
};

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '凌晨好';
  if (hour < 9) return '早上好';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export default function WelcomeSection({
  projects,
  onNewSession,
  onOpenProject,
  onNewTask,
  onImportDoc,
  onQuickSubmit,
}: WelcomeSectionProps) {
  const [quickInput, setQuickInput] = useState('');
  const greetingText = useMemo(() => greeting(), []);
  const hasProjects = projects.length > 0;

  const submit = () => {
    const text = quickInput.trim();
    if (!text) return;
    onQuickSubmit(text);
    setQuickInput('');
  };

  return (
    <section className="animate-fade-in rounded-2xl bg-gradient-to-br from-brand-50 via-brand-100 to-violet-50 p-6 dark:from-brand-950 dark:via-brand-900 dark:to-indigo-950 lg:p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-bold text-surface-900 dark:text-white">
            {greetingText}，老板
          </h1>
          <p className="text-sm text-surface-500 dark:text-surface-400">今天想做什么？</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onNewSession}
            disabled={!hasProjects}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-brand-500/20 transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" strokeWidth={1.75} />
            新建会话
          </button>
          <WelcomeButton icon={FolderOpen} label="打开项目" onClick={onOpenProject} to="/projects" />
          <WelcomeButton icon={Zap} label="新建任务" onClick={onNewTask} />
          <WelcomeButton icon={FileUp} label="导入文档" onClick={onImportDoc} />
        </div>
      </div>

      <div className="mt-4">
        <div className="relative">
          <input
            type="text"
            value={quickInput}
            onChange={(event) => setQuickInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                submit();
              }
            }}
            placeholder="或直接告诉我你想做什么，例如：帮我 review 昨天的代码"
            className="h-11 w-full rounded-xl border border-surface-200 bg-white/80 pl-4 pr-12 text-sm text-surface-900 outline-none backdrop-blur transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-surface-700 dark:bg-surface-800/80 dark:text-surface-100"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!quickInput.trim() || !hasProjects}
            className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-lg bg-brand-600 p-1.5 text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            title={hasProjects ? '发送' : '请先创建项目'}
          >
            <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </section>
  );
}

function WelcomeButton({
  icon: Icon,
  label,
  onClick,
  to,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  to?: string;
}) {
  const className = 'inline-flex items-center gap-2 rounded-xl border border-surface-200 bg-white/70 px-4 py-2.5 text-sm font-medium text-surface-700 backdrop-blur transition hover:bg-white dark:border-surface-700 dark:bg-surface-800/70 dark:text-surface-200 dark:hover:bg-surface-700';

  if (to) {
    return (
      <a
        href={to}
        onClick={(event) => {
          event.preventDefault();
          window.location.assign(to);
        }}
        className={className}
      >
        <Icon className="h-4 w-4" strokeWidth={1.75} />
        {label}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
    >
      <Icon className="h-4 w-4" strokeWidth={1.75} />
      {label}
    </button>
  );
}
