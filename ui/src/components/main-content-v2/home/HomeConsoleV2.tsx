import { useCallback, useMemo } from 'react';
import type { AppTab, Project, ProjectSession } from '../../../types/app';
import type { HomeDashboardData, HomeSessionCard } from '../../../hooks/useHomeDashboardData';
import type { DashboardData } from '../../../hooks/useRoutingDashboard';
import WelcomeSection from './WelcomeSection';
import TodaySummary from './TodaySummary';
import ContinueWork from './ContinueWork';
import ProjectsOverview from './ProjectsOverview';
import ActivityTimeline from './ActivityTimeline';
import QuickTools from './QuickTools';
import { formatCost } from './homeUtils';

type HomeConsoleV2Props = {
  projects: Project[];
  onSelectProjectByName?: (projectName: string) => void;
  onSelectSession?: (project: Project, sessionId: string, fallbackSession?: ProjectSession) => void;
  onStartNewSession: (project: Project) => void;
  onCreateProject?: () => void;
  onShowSettings: () => void;
  setActiveTab: (tab: AppTab) => void;
  homeData: HomeDashboardData;
  routingData?: DashboardData | null;
};

function pickDefaultProject(projects: Project[]): Project | null {
  return projects.find((project) => project.name === 'general' || project.displayName === 'general') ?? projects[0] ?? null;
}

export default function HomeConsoleV2({
  projects,
  onSelectProjectByName,
  onSelectSession,
  onStartNewSession,
  onCreateProject,
  onShowSettings,
  setActiveTab,
  homeData,
  routingData = null,
}: HomeConsoleV2Props) {
  const defaultProject = useMemo(() => pickDefaultProject(projects), [projects]);
  const costBucket = routingData?.overall?.total;
  const hasTodayCost = homeData.cost.hasTodayWindow && homeData.cost.todayRequestCount > 0;
  const hasRecentCost = homeData.cost.requestCount > 0;
  const recentCost = hasTodayCost
    ? homeData.cost.todayAmount
    : hasRecentCost
      ? homeData.cost.recentAmount
      : costBucket?.estimatedCost ?? 0;
  const recentSaved = hasTodayCost
    ? homeData.cost.todaySaved
    : hasRecentCost
      ? homeData.cost.recentSaved
      : costBucket?.savedCost ?? 0;
  const costScope = hasTodayCost ? 'today' : 'recent';
  const costFooter = hasTodayCost
    ? `本周累计 ${formatCost(homeData.cost.weekTotal)}`
    : '查看数据';

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
          recentCost={recentCost}
          recentSaved={recentSaved}
          costScope={costScope}
          costFooter={costFooter}
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
