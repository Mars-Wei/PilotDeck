import { useCallback, useMemo } from 'react';
import type { AppTab, Project, ProjectSession } from '../../../types/app';
import { useHomeDashboardData, type HomeSessionCard } from '../../../hooks/useHomeDashboardData';
import { useRoutingDashboard } from '../../../hooks/useRoutingDashboard';
import WelcomeSection from './WelcomeSection';
import TodaySummary from './TodaySummary';
import ContinueWork from './ContinueWork';
import ProjectsOverview from './ProjectsOverview';
import ActivityTimeline from './ActivityTimeline';
import QuickTools from './QuickTools';

type HomeConsoleV2Props = {
  projects: Project[];
  processingSessions: Set<string>;
  unreadSessionIds: Set<string>;
  onSelectProjectByName?: (projectName: string) => void;
  onSelectSession?: (project: Project, sessionId: string, fallbackSession?: ProjectSession) => void;
  onStartNewSession: (project: Project) => void;
  onCreateProject?: () => void;
  onShowSettings: () => void;
  setActiveTab: (tab: AppTab) => void;
};

function pickDefaultProject(projects: Project[]): Project | null {
  return projects.find((project) => project.name === 'general' || project.displayName === 'general') ?? projects[0] ?? null;
}

export default function HomeConsoleV2({
  projects,
  processingSessions,
  unreadSessionIds,
  onSelectProjectByName,
  onSelectSession,
  onStartNewSession,
  onCreateProject,
  onShowSettings,
  setActiveTab,
}: HomeConsoleV2Props) {
  const homeData = useHomeDashboardData({
    projects,
    processingSessions,
    unreadSessionIds,
  });
  const routing = useRoutingDashboard();

  const defaultProject = useMemo(() => pickDefaultProject(projects), [projects]);
  const costBucket = routing.data?.overall?.total;

  const selectProject = useCallback(
    (projectName: string) => {
      onSelectProjectByName?.(projectName);
      setActiveTab('chat');
    },
    [onSelectProjectByName, setActiveTab],
  );

  const openTab = useCallback(
    (tab: AppTab) => {
      if (tab === 'home') {
        setActiveTab('home');
        return;
      }
      if (!defaultProject && tab !== 'dashboard') {
        setActiveTab(tab);
        return;
      }
      if (defaultProject) {
        onSelectProjectByName?.(defaultProject.name);
      }
      setActiveTab(tab);
    },
    [defaultProject, onSelectProjectByName, setActiveTab],
  );

  const startNewSession = useCallback(
    (prompt?: string) => {
      const project = defaultProject;
      if (!project) {
        onCreateProject?.();
        return;
      }
      onStartNewSession(project);
      onSelectProjectByName?.(project.name);
      setActiveTab('chat');
      if (prompt) {
        window.sessionStorage.setItem('pilotdeck-home-pending-prompt', prompt);
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('pilotdeck-home-prompt', { detail: { prompt } }));
        }, 0);
      }
    },
    [defaultProject, onCreateProject, onSelectProjectByName, onStartNewSession, setActiveTab],
  );

  const enterSession = useCallback(
    (item: HomeSessionCard) => {
      onSelectSession?.(item.project, item.session.id, item.session);
      setActiveTab('chat');
    },
    [onSelectSession, setActiveTab],
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 lg:px-8">
        <WelcomeSection
          projects={projects}
          onNewSession={() => startNewSession()}
          onOpenProject={() => {
            if (defaultProject) selectProject(defaultProject.name);
            else onCreateProject?.();
          }}
          onNewTask={() => openTab('always-on')}
          onImportDoc={() => openTab('files')}
          onQuickSubmit={(text) => startNewSession(text)}
        />
        <TodaySummary
          recentCost={costBucket?.estimatedCost ?? 0}
          recentSaved={costBucket?.savedCost ?? 0}
          taskStats={homeData.taskStats}
          unreadCount={homeData.unreadCount}
          unreadSessionCount={homeData.unreadSessions.length}
          alerts={homeData.alerts}
          onOpenDashboard={() => openTab('dashboard')}
          onOpenAlwaysOn={() => openTab('always-on')}
          onOpenChat={() => openTab('chat')}
        />
        <ContinueWork
          sessions={homeData.activeSessions}
          onEnterSession={enterSession}
          onShowAll={() => openTab('chat')}
        />
        <ProjectsOverview
          projects={homeData.recentProjects}
          onSelectProject={selectProject}
          onCreateProject={() => onCreateProject?.()}
        />
        <ActivityTimeline
          activities={homeData.activities}
          projects={projects}
          onOpenProject={selectProject}
          onShowAll={() => openTab('dashboard')}
        />
        <QuickTools
          disabled={!defaultProject}
          onRunTool={(prompt) => startNewSession(prompt)}
        />
      </div>
      <button
        type="button"
        onClick={onShowSettings}
        className="sr-only"
      >
        打开设置
      </button>
    </div>
  );
}
