import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Project } from '../../../../types/app';
import { AUTH_TOKEN_STORAGE_KEY } from '../../../auth/constants';
import { useTheme } from '../../../../contexts/ThemeContext';

const OpenChronicleMemoryView = lazy(() => import('./OpenChronicleMemoryView'));

type MemoryPanelProps = {
  selectedProject: Project | null;
};

type SubView = 'opc' | 'openchronicle';

function normalizeMemoryLocale(language: string | undefined): 'zh' | 'en' {
  return language === 'zh-CN' ? 'zh' : 'en';
}

function normalizeMemoryTheme(isDarkMode: boolean): 'light' | 'dark' {
  return isDarkMode ? 'dark' : 'light';
}

const MEMORY_PANEL_TEXT: Record<'zh' | 'en', {
  emptyProject: string;
  unavailable: string;
  title: string;
  opcTab: string;
  openChronicleTab: string;
}> = {
  zh: {
    emptyProject: '请选择一个项目查看 Memory。',
    unavailable: '身份验证和项目上下文准备完成后，Memory 面板才可用。',
    title: 'Memory 面板',
    opcTab: '对话记忆',
    openChronicleTab: '工作记忆',
  },
  en: {
    emptyProject: 'Select a project to inspect memory.',
    unavailable: 'Memory dashboard is unavailable until auth and project context are ready.',
    title: 'Memory 面板',
    opcTab: 'Conversation Memory',
    openChronicleTab: 'Work Memory',
  },
};

function buildMemoryDashboardUrl(project: Project, locale: 'zh' | 'en', theme: 'light' | 'dark'): string | null {
  const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  const projectPath = project.fullPath || project.path;

  if (!projectPath) {
    return null;
  }

  const params = new URLSearchParams({ projectPath, locale, theme });
  if (token) {
    params.set('token', token);
  }

  return `/memory-dashboard/index.html?${params.toString()}`;
}

function OpcBrainMemoryView({
  selectedProject,
  locale,
  theme,
}: {
  selectedProject: Project | null;
  locale: 'zh' | 'en';
  theme: 'light' | 'dark';
}) {
  const text = MEMORY_PANEL_TEXT[locale];

  if (!selectedProject) {
    return (
      <div className="flex h-full items-center justify-center bg-white text-[13px] text-neutral-500 dark:bg-neutral-950 dark:text-neutral-400">
        {text.emptyProject}
      </div>
    );
  }

  const dashboardUrl = buildMemoryDashboardUrl(selectedProject, locale, theme);
  if (!dashboardUrl) {
    return (
      <div className="flex h-full items-center justify-center bg-white text-[13px] text-neutral-500 dark:bg-neutral-950 dark:text-neutral-400">
        {text.unavailable}
      </div>
    );
  }

  // Outer shell mirrors MainAreaV2's chrome (white / neutral-950) so the
  // iframe blends seamlessly when the V2 dashboard is rendered full-screen
  // — avoids the dark-mode "two-tone" line + legacy overlap that showed up
  // when Memory was previously paired with chat in a split pane.
  return (
    <div className="h-full w-full bg-white dark:bg-neutral-950">
      <iframe
        key={`${selectedProject.fullPath || selectedProject.path || 'memory'}:${locale}:${theme}`}
        title={text.title}
        src={dashboardUrl}
        className="block h-full w-full border-0 bg-white dark:bg-neutral-950"
      />
    </div>
  );
}

export default function MemoryPanel({ selectedProject }: MemoryPanelProps) {
  const { i18n } = useTranslation();
  const { isDarkMode } = useTheme();
  const memoryLocale = normalizeMemoryLocale(i18n.language);
  const memoryTheme = normalizeMemoryTheme(isDarkMode);
  const text = MEMORY_PANEL_TEXT[memoryLocale];

  const [subView, setSubView] = useState<SubView>('opc');

  return (
    <div className="flex h-full w-full flex-col bg-white dark:bg-neutral-950">
      {/* Segmented sub-view switcher: project memory (OPC Brain) vs local
          desktop-context memory (OpenChronicle). OpenChronicle is user-level,
          so it stays available even without a selected project. */}
      <div className="flex shrink-0 items-center gap-1 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        {(['opc', 'openchronicle'] as SubView[]).map((view) => {
          const active = subView === view;
          return (
            <button
              key={view}
              type="button"
              onClick={() => setSubView(view)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100'
              }`}
            >
              {view === 'opc' ? text.opcTab : text.openChronicleTab}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1">
        {subView === 'opc' ? (
          <OpcBrainMemoryView selectedProject={selectedProject} locale={memoryLocale} theme={memoryTheme} />
        ) : (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center bg-white text-[13px] text-neutral-500 dark:bg-neutral-950 dark:text-neutral-400">
                …
              </div>
            }
          >
            <OpenChronicleMemoryView locale={memoryLocale} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
