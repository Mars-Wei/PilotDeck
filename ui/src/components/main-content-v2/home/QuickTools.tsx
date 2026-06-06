import {
  Code2,
  FileText,
  Globe2,
  PlayCircle,
  SearchCode,
  Sparkles,
  Trash2,
  type LucideIcon,
} from 'lucide-react';

type QuickTool = {
  id: string;
  label: string;
  icon: LucideIcon;
  prompt: string;
};

type QuickToolsProps = {
  disabled?: boolean;
  onRunTool: (prompt: string) => void;
};

const QUICK_TOOLS: QuickTool[] = [
  {
    id: 'code',
    label: '写代码',
    icon: Code2,
    prompt: '帮我基于当前项目实现一个小功能。先阅读相关代码，再给出实现并验证。',
  },
  {
    id: 'search',
    label: '搜代码',
    icon: SearchCode,
    prompt: '帮我在当前项目里查找相关代码位置，并总结关键实现路径。',
  },
  {
    id: 'web',
    label: '抓网页',
    icon: Globe2,
    prompt: '帮我抓取并整理一个网页内容。请先问我要 URL，之后提炼重点。',
  },
  {
    id: 'slides',
    label: '生成 PPT',
    icon: Sparkles,
    prompt: '帮我把现有材料整理成一份 PPT 大纲，并说明每页内容。',
  },
  {
    id: 'cleanup',
    label: '清理文件',
    icon: Trash2,
    prompt: '帮我分析当前项目里可以清理的临时文件和构建产物。先列清单，不要直接删除。',
  },
  {
    id: 'test',
    label: '跑测试',
    icon: PlayCircle,
    prompt: '帮我运行当前项目的相关测试，定位失败原因，并给出修复建议。',
  },
  {
    id: 'docs',
    label: '写文档',
    icon: FileText,
    prompt: '帮我根据当前项目代码补充一份简洁的开发文档。',
  },
];

export default function QuickTools({ disabled = false, onRunTool }: QuickToolsProps) {
  return (
    <section className="animate-fade-in" style={{ animationDelay: '260ms' }}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">快捷工具</h2>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-7">
        {QUICK_TOOLS.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.id}
              type="button"
              disabled={disabled}
              onClick={() => onRunTool(tool.prompt)}
              className="group flex h-24 min-w-0 flex-col items-center justify-center gap-2 rounded-xl border border-surface-200 bg-white px-2 text-sm font-medium text-surface-700 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:text-brand-700 hover:shadow-lg hover:shadow-surface-200/30 disabled:cursor-not-allowed disabled:opacity-50 dark:border-surface-800 dark:bg-surface-900 dark:text-surface-300 dark:hover:border-brand-900 dark:hover:text-brand-300 dark:hover:shadow-black/20"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-100 text-surface-500 transition group-hover:bg-brand-50 group-hover:text-brand-600 dark:bg-surface-800 dark:text-surface-400 dark:group-hover:bg-brand-900/30 dark:group-hover:text-brand-300">
                <Icon className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <span className="max-w-full truncate">{tool.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
