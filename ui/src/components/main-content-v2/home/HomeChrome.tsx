import { useCallback, useMemo } from 'react';
import type { AppTab, Project } from '../../../types/app';
import type { DashboardData } from '../../../hooks/useRoutingDashboard';
import type { HomeAlertItem, HomeCostSummary, HomeSessionCard, HomeTaskStats } from '../../../hooks/useHomeDashboardData';
import { useHomeStatus } from '../../../hooks/useHomeStatus';
import TopHeader from './TopHeader';
import HomeSidebar, { type HomeNavId } from './HomeSidebar';
import SystemStatusPanel from './SystemStatusPanel';

type HomeChromeProps = {
  children: React.ReactNode;
  activeTab: AppTab;
  projects: Project[];
  recentProjects: Project[];
  unreadCount: number;
  unreadSessions: HomeSessionCard[];
  runningCount: number;
  isConnected: boolean;
  isLoadingProjects: boolean;
  routingData: DashboardData | null;
  routingError: string | null;
  homeCost: HomeCostSummary;
  taskStats: HomeTaskStats;
  alerts: HomeAlertItem[];
  alwaysOnError: string | null;
  onSetActiveTab: (tab: AppTab) => void;
  onSelectProjectByName?: (projectName: string) => void;
  onOpenSession?: (item: HomeSessionCard) => void;
  onCreateProject?: () => void;
  onShowSettings: () => void;
  onOpenApiKeys: () => void;
};

function pickDefaultProject(projects: Project[]): Project | null {
  return projects.find((project) => project.name === 'general' || project.displayName === 'general') ?? projects[0] ?? null;
}

export default function HomeChrome({
  children,
  activeTab,
  projects,
  recentProjects,
  unreadCount,
  unreadSessions,
  runningCount,
  isConnected,
  isLoadingProjects,
  routingData,
  routingError,
  homeCost,
  taskStats,
  alerts,
  alwaysOnError,
  onSetActiveTab,
  onSelectProjectByName,
  onOpenSession,
  onCreateProject,
  onShowSettings,
  onOpenApiKeys,
}: HomeChromeProps) {
  const defaultProject = useMemo(() => pickDefaultProject(projects), [projects]);
  const homeStatus = useHomeStatus({
    initialDelayMs: activeTab === 'home' ? 1_100 : 0,
  });

  const openTab = useCallback(
    (tab: AppTab) => {
      if (tab === 'home' || tab === 'sessions' || tab === 'projects') {
        onSetActiveTab(tab);
        return;
      }
      if (!defaultProject && tab !== 'dashboard') {
        onCreateProject?.();
        return;
      }
      if (defaultProject) {
        onSelectProjectByName?.(defaultProject.name);
      }
      onSetActiveTab(tab);
    },
    [defaultProject, onCreateProject, onSelectProjectByName, onSetActiveTab],
  );

  const selectProject = useCallback(
    (projectName: string) => {
      onSelectProjectByName?.(projectName);
      onSetActiveTab('chat');
    },
    [onSelectProjectByName, onSetActiveTab],
  );

  const handleNavClick = useCallback(
    (id: HomeNavId) => {
      openTab(id);
    },
    [openTab],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-50 text-surface-900 dark:bg-surface-950 dark:text-surface-100">
      <TopHeader
        projects={projects}
        recentProjects={recentProjects}
        unreadCount={unreadCount}
        unreadSessions={unreadSessions}
        onHomeClick={() => onSetActiveTab('home')}
        onOpenTab={openTab}
        onOpenProject={selectProject}
        onOpenSession={(item) => {
          onOpenSession?.(item);
        }}
        onOpenChat={() => openTab('chat')}
        onCreateProject={onCreateProject}
        onOpenSettings={onShowSettings}
      />
      <div className="flex min-h-0 flex-1">
        <HomeSidebar
          activeId={activeTab}
          projects={recentProjects}
          unreadCount={unreadCount}
          runningCount={runningCount}
          onTabClick={handleNavClick}
          onProjectClick={selectProject}
        />
        <div className="min-w-0 flex-1 overflow-hidden">
          {children}
        </div>
        <SystemStatusPanel
          isConnected={isConnected}
          isLoadingProjects={isLoadingProjects}
          statusData={homeStatus.data}
          statusError={homeStatus.error}
          routingData={routingData}
          routingError={routingError}
          homeCost={homeCost}
          taskStats={taskStats}
          alerts={alerts}
          alwaysOnError={alwaysOnError}
          onOpenDashboard={() => openTab('dashboard')}
          onOpenSettings={onShowSettings}
          onOpenApiKeys={onOpenApiKeys}
        />
      </div>
    </div>
  );
}
