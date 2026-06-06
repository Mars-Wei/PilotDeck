import { useCallback, useEffect, useRef, useState } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import ReactDOM from 'react-dom';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useDeviceSettings } from '../../hooks/useDeviceSettings';
import { useSessionProtection } from '../../hooks/useSessionProtection';
import { useProjectsState } from '../../hooks/useProjectsState';
import Settings from '../settings/view/Settings';
import ProjectCreationWizard from '../project-creation-wizard';
import { normalizeProjectForSettings, type SettingsProject } from '../../lib/projectSettings';
import {
  type AppTab,
  type Project,
  type ProjectSession,
} from '../../types/app';
import HomeChrome from '../main-content-v2/home/HomeChrome';
import { useHomeDashboardData } from '../../hooks/useHomeDashboardData';
import { useRoutingDashboard } from '../../hooks/useRoutingDashboard';
import MainAreaV2 from './MainAreaV2';

type TypedSettingsProps = {
  isOpen: boolean;
  onClose: () => void;
  projects: SettingsProject[];
  initialTab: string;
};

const SettingsComponent = Settings as unknown as (props: TypedSettingsProps) => JSX.Element;

const UNREAD_IGNORED_MESSAGE_TYPES = new Set([
  'websocket-reconnected',
  'pending-permissions-response',
  'session-status',
]);

const UNREAD_IGNORED_MESSAGE_KINDS = new Set([
  'session_created',
  'status',
  'stream_end',
]);

const getSessionIdFromMessage = (message: unknown): string | null => {
  if (!message || typeof message !== 'object') return null;
  const candidate = message as {
    sessionId?: unknown;
    session_id?: unknown;
    newSessionId?: unknown;
    actualSessionId?: unknown;
  };
  const value =
    candidate.sessionId ??
    candidate.session_id ??
    candidate.actualSessionId ??
    candidate.newSessionId;
  return typeof value === 'string' && value.trim() ? value : null;
};

const isUnreadWorthyMessage = (message: unknown): boolean => {
  if (!message || typeof message !== 'object') return false;
  const candidate = message as { kind?: unknown; type?: unknown };

  if (typeof candidate.kind === 'string') {
    return !UNREAD_IGNORED_MESSAGE_KINDS.has(candidate.kind);
  }

  if (typeof candidate.type === 'string') {
    return !UNREAD_IGNORED_MESSAGE_TYPES.has(candidate.type);
  }

  return false;
};

// V2 shell. Reuses the same data hooks as legacy AppContent so chat, discovery,
// auth, and project plumbing keep working unchanged — V2 just reorganizes the
// outer chrome (sidebar + breadcrumb header per prototype/shadcn.html).
export default function AppShellV2() {
  const navigate = useNavigate();
  // Match the four V2 URL shapes and hoist params up. A single wildcard route
  // owns this shell so state survives every URL transition.
  const matchProjectChat = useMatch('/p/:projectName/c/:sessionId');
  const matchProject = useMatch('/p/:projectName');
  const matchLegacySession = useMatch('/session/:sessionId');
  const projectNameParam =
    matchProjectChat?.params.projectName ?? matchProject?.params.projectName ?? undefined;
  const sessionId =
    matchProjectChat?.params.sessionId ?? matchLegacySession?.params.sessionId ?? undefined;

  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { ws, sendMessage, latestMessage, isConnected, subscribe } = useWebSocket();
  const wasConnectedRef = useRef(false);
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => new Set());

  const {
    activeSessions,
    processingSessions,
    markSessionAsActive,
    markSessionAsInactive,
    markSessionAsProcessing,
    markSessionAsNotProcessing,
    replaceTemporarySession,
  } = useSessionProtection();

  const {
    selectedProject,
    selectedSession,
    activeTab,
    isLoadingProjects,
    externalMessageUpdate,
    setActiveTab,
    setSelectedSession,
    setIsInputFocused,
    setShowSettings,
    openSettings,
    refreshProjectsSilently,
    sidebarSharedProps,
    handleProjectSelect,
    handleSessionSelect,
    handleNewSession,
    setSelectedProject,
    bumpSessionActivity,
    replaceOptimisticInProjects,
    dropOptimisticInProjects,
  } = useProjectsState({
    sessionId,
    navigate,
    latestMessage,
    isMobile,
    activeSessions,
  });

  const homeData = useHomeDashboardData({
    projects: sidebarSharedProps.projects,
    processingSessions,
    unreadSessionIds,
  });
  const routingDashboard = useRoutingDashboard();

  // Sync URL projectName -> selectedProject for deep links like /p/:projectName.
  // When the URL also carries a session id (/p/.../c/:sessionId or
  // /session/:sessionId) we let useProjectsState own the resolution because
  // it sets BOTH the project and the session in one effect, avoiding a race
  // where this hook would clear the session via handleProjectSelect.
  useEffect(() => {
    if (!projectNameParam) return;
    if (sessionId) return;
    if (selectedProject?.name === projectNameParam) return;
    const target = sidebarSharedProps.projects.find((p) => p.name === projectNameParam);
    if (target) {
      handleProjectSelect(target);
      // handleProjectSelect unconditionally navigates to '/' — put the URL back.
      navigate(`/p/${encodeURIComponent(projectNameParam)}`, { replace: true });
    }
  }, [
    projectNameParam,
    sessionId,
    selectedProject?.name,
    sidebarSharedProps.projects,
    handleProjectSelect,
    navigate,
  ]);

  // Default selection is only for deep links. The bare root is the home
  // dashboard, so it should not auto-jump into the general project.
  const didDefaultProjectRef = useRef(false);
  useEffect(() => {
    if (didDefaultProjectRef.current) return;
    if (isLoadingProjects) return;
    if (selectedProject) {
      didDefaultProjectRef.current = true;
      return;
    }
    if (projectNameParam || sessionId) {
      didDefaultProjectRef.current = true;
      return;
    }
    didDefaultProjectRef.current = true;
  }, [
    isLoadingProjects,
    selectedProject,
    projectNameParam,
    sessionId,
  ]);

  useEffect(() => {
    if (isLoadingProjects) return;
    if (projectNameParam || sessionId || selectedProject) return;
    if (activeTab !== 'home') {
      setActiveTab('home');
    }
  }, [
    activeTab,
    isLoadingProjects,
    projectNameParam,
    selectedProject,
    sessionId,
    setActiveTab,
  ]);

  useEffect(() => {
    window.refreshProjects = refreshProjectsSilently;
    return () => {
      if (window.refreshProjects === refreshProjectsSilently) {
        delete window.refreshProjects;
      }
    };
  }, [refreshProjectsSilently]);

  useEffect(() => {
    window.openSettings = openSettings;
    return () => {
      if (window.openSettings === openSettings) {
        delete window.openSettings;
      }
    };
  }, [openSettings]);

  // Resolve a project by name (exact match first, then case-insensitive on
  // both the directory name and the user-facing displayName, then a relaxed
  // case-insensitive substring) and select it via the same handler the
  // sidebar uses, so the chat slash command `/switch-project xxx` can hop
  // between projects without a manual click.
  const switchProject = useCallback(
    (projectName: string): boolean => {
      const trimmed = (projectName ?? '').trim();
      if (!trimmed) return false;

      const list = sidebarSharedProps.projects;
      const exact = list.find((p) => p.name === trimmed);
      const ciExact =
        exact ??
        list.find(
          (p) =>
            p.name.toLowerCase() === trimmed.toLowerCase() ||
            (p.displayName ?? '').toLowerCase() === trimmed.toLowerCase(),
        );
      const fuzzy =
        ciExact ??
        list.find(
          (p) =>
            p.name.toLowerCase().includes(trimmed.toLowerCase()) ||
            (p.displayName ?? '').toLowerCase().includes(trimmed.toLowerCase()),
        );
      const target = fuzzy;
      if (!target) return false;

      handleProjectSelect(target);
      navigate(`/p/${encodeURIComponent(target.name)}`);
      return true;
    },
    [handleProjectSelect, navigate, sidebarSharedProps.projects],
  );

  useEffect(() => {
    window.switchProject = switchProject;
    return () => {
      if (window.switchProject === switchProject) {
        delete window.switchProject;
      }
    };
  }, [switchProject]);

  useEffect(() => {
    const selectedSessionId = selectedSession?.id;
    if (!selectedSessionId) return;

    setUnreadSessionIds((previous) => {
      if (!previous.has(selectedSessionId)) return previous;
      const next = new Set(previous);
      next.delete(selectedSessionId);
      return next;
    });
  }, [selectedSession?.id]);

  useEffect(() => {
    return subscribe((message) => {
      if (!isUnreadWorthyMessage(message)) return;

      const messageSessionId = getSessionIdFromMessage(message);
      if (!messageSessionId || messageSessionId === selectedSession?.id) return;

      setUnreadSessionIds((previous) => {
        if (previous.has(messageSessionId)) return previous;
        const next = new Set(previous);
        next.add(messageSessionId);
        return next;
      });
    });
  }, [selectedSession?.id, subscribe]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return undefined;
    }

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!message || message.type !== 'notification:navigate') return;

      // Provider hint from notifications is no longer stored; all sessions
      // go through the unified pilotdeck gateway.

      setActiveTab('chat');
      void refreshProjectsSilently();

      if (typeof message.sessionId === 'string' && message.sessionId) {
        navigate(`/session/${message.sessionId}`);
        return;
      }
      navigate('/');
    };

    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, [navigate, refreshProjectsSilently, setActiveTab]);

  useEffect(() => {
    const isReconnect = isConnected && !wasConnectedRef.current;
    if (isReconnect) {
      wasConnectedRef.current = true;
    } else if (!isConnected) {
      wasConnectedRef.current = false;
    }

    if (isConnected && selectedSession?.id) {
      sendMessage({
        type: 'get-pending-permissions',
        sessionId: selectedSession.id,
      });
    }
  }, [isConnected, selectedSession?.id, sendMessage]);

  const onShowSettings = useCallback(() => setShowSettings(true), [setShowSettings]);
  const onCloseSettings = useCallback(() => setShowSettings(false), [setShowSettings]);

  // Project creation wizard (local existing / new local / github clone). The
  // sidebar's Projects-section "+" opens this; row-level "+" is for new sessions.
  const [showNewProject, setShowNewProject] = useState(false);
  const handleOpenNewProject = useCallback(() => setShowNewProject(true), []);
  const handleCloseNewProject = useCallback(() => setShowNewProject(false), []);
  const handleProjectCreated = useCallback((project?: Record<string, unknown>) => {
    setShowNewProject(false);
    void refreshProjectsSilently();

    // Auto-jump into the new project's empty new-conversation screen so the
    // user doesn't accidentally keep chatting under the previously selected
    // project (typically "general") after closing the wizard. The wizard
    // hands back the freshly created project from POST /create-workspace
    // (and the clone SSE complete event), which is the same `{ name,
    // displayName, fullPath, path }` shape as the sidebar list entries.
    const projectName = typeof project?.name === 'string' ? project.name : '';
    if (!projectName) return;
    const newProject = project as Project;
    handleNewSession(newProject);
    navigate(`/p/${encodeURIComponent(projectName)}`);
    setActiveTab('chat');
  }, [handleNewSession, navigate, refreshProjectsSilently, setActiveTab]);

  const handleSelectSession = useCallback(
    (project: Project, sessId: string, fallbackSession?: ProjectSession) => {
      setUnreadSessionIds((previous) => {
        if (!previous.has(sessId)) return previous;
        const next = new Set(previous);
        next.delete(sessId);
        return next;
      });
      if (project.name !== selectedProject?.name) {
        handleProjectSelect(project);
      }
      const target = (project.sessions ?? []).find((s) => s.id === sessId);
      if (target) {
        handleSessionSelect(target);
      } else if (fallbackSession) {
        handleSessionSelect(fallbackSession);
      } else {
        navigate(`/session/${sessId}`);
      }
      setActiveTab('chat');
    },
    [handleProjectSelect, handleSessionSelect, navigate, selectedProject?.name, setActiveTab],
  );

  const handleSelectProjectByName = useCallback(
    (name: string) => {
      const target = sidebarSharedProps.projects.find((p) => p.name === name);
      if (target) {
        setSelectedProject(target);
        setSelectedSession(null);
        navigate(`/p/${encodeURIComponent(target.name)}`);
      }
    },
    [navigate, setSelectedProject, setSelectedSession, sidebarSharedProps.projects],
  );

  const handleSelectTab = useCallback(
    (tab: AppTab) => {
      if (tab === 'home') {
        setSelectedProject(null);
        setSelectedSession(null);
        navigate('/');
        setActiveTab('home');
        return;
      }
      setActiveTab(tab);
    },
    [navigate, setActiveTab, setSelectedProject, setSelectedSession],
  );

  // Wrap the two session-lifecycle callbacks coming out of useSessionProtection
  // so they also reconcile the optimistic placeholder rows in the sidebar:
  //  · `session_created` → swap `new-session-*` in projects.sessions for the
  //    real id in-place (no flicker).
  //  · `complete` / `error` → drop any leftover `new-session-*` placeholder
  //    that was never replaced (agent never emitted session_created).
  const handleReplaceTemporarySession = useCallback(
    (realSessionId?: string | null) => {
      replaceTemporarySession(realSessionId);
      if (realSessionId) replaceOptimisticInProjects(realSessionId);
    },
    [replaceTemporarySession, replaceOptimisticInProjects],
  );

  const handleSessionInactive = useCallback(
    (sessionId?: string | null) => {
      markSessionAsInactive(sessionId);
      if (sessionId) dropOptimisticInProjects(sessionId);
    },
    [markSessionAsInactive, dropOptimisticInProjects],
  );

  return (
    <div className="ui-v2 fixed inset-0 flex bg-white font-sans text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <main className="flex min-w-0 flex-1 flex-col">
        <HomeChrome
          activeTab={activeTab}
          projects={sidebarSharedProps.projects}
          recentProjects={homeData.recentProjects}
          unreadCount={homeData.unreadCount}
          runningCount={homeData.taskStats.running}
          isConnected={isConnected}
          isLoadingProjects={isLoadingProjects}
          routingData={routingDashboard.data}
          routingError={routingDashboard.error}
          taskStats={homeData.taskStats}
          alerts={homeData.alerts}
          alwaysOnError={homeData.alwaysOnError}
          onSetActiveTab={handleSelectTab}
          onSelectProjectByName={handleSelectProjectByName}
          onCreateProject={handleOpenNewProject}
          onShowSettings={onShowSettings}
        >
          <MainAreaV2
            projects={sidebarSharedProps.projects}
            selectedProject={selectedProject}
            selectedSession={selectedSession}
            activeTab={activeTab}
            setActiveTab={handleSelectTab}
            ws={ws}
            sendMessage={sendMessage}
            latestMessage={latestMessage}
            isMobile={isMobile}
            onMenuClick={() => undefined}
            isLoading={isLoadingProjects}
            onInputFocusChange={setIsInputFocused}
            onSessionActive={markSessionAsActive}
            onSessionInactive={handleSessionInactive}
            onSessionProcessing={markSessionAsProcessing}
            onSessionNotProcessing={markSessionAsNotProcessing}
            onSessionActivityBump={bumpSessionActivity}
            processingSessions={processingSessions}
            unreadSessionIds={unreadSessionIds}
            onReplaceTemporarySession={handleReplaceTemporarySession}
            onNavigateToSession={(sid: string) => {
              setSelectedSession((prev) => prev?.id === sid ? prev : { id: sid } as ProjectSession);
              navigate(`/session/${sid}`);
            }}
            onStartNewSession={handleNewSession}
            onSelectSession={handleSelectSession}
            onShowSettings={onShowSettings}
            onCreateProject={handleOpenNewProject}
            onSelectProjectByName={handleSelectProjectByName}
            isSidebarCollapsed={false}
            externalMessageUpdate={externalMessageUpdate}
          />
        </HomeChrome>
      </main>

      {sidebarSharedProps.showSettings
        ? ReactDOM.createPortal(
            <SettingsComponent
              isOpen={sidebarSharedProps.showSettings}
              onClose={onCloseSettings}
              projects={sidebarSharedProps.projects.map(normalizeProjectForSettings)}
              initialTab={sidebarSharedProps.settingsInitialTab || 'appearance'}
            />,
            document.body,
          )
        : null}

      {showNewProject
        ? ReactDOM.createPortal(
            <ProjectCreationWizard
              onClose={handleCloseNewProject}
              onProjectCreated={handleProjectCreated}
            />,
            document.body,
          )
        : null}
	    </div>
	  );
	}
