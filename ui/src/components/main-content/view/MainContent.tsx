import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart3,
  Brain,
  FolderOpen,
  GitBranch,
  MessageSquare,
  Puzzle,
  Terminal,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import HomeConsoleV2 from '../../main-content-v2/home/HomeConsoleV2';
import { cn } from '../../../lib/utils.js';
import type { MainContentProps } from '../types/types';
import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useEditorSidebar } from '../../code-editor/hooks/useEditorSidebar';
import type { CodeEditorDiffInfo } from '../../code-editor/types/types';
import type {
  AlwaysOnSessionTarget,
  Project,
  ProjectSession,
} from '../../../types/app';
import type { HomeDashboardData } from '../../../hooks/useHomeDashboardData';
import type { DashboardData } from '../../../hooks/useRoutingDashboard';
import { api } from '../../../utils/api';
import {
  clearAlwaysOnPresence,
  sendAlwaysOnPresence,
} from '../../../utils/alwaysOnPresence';
import MainContentStateView from './subcomponents/MainContentStateView';
import ErrorBoundary from './ErrorBoundary';

const ChatInterfaceV2 = lazy(() => import('../../chat-v2/ChatInterfaceV2'));
const SessionsV2 = lazy(() => import('../../main-content-v2/SessionsV2'));
const ProjectsV2 = lazy(() => import('../../main-content-v2/ProjectsV2'));
const AlwaysOnV2 = lazy(() => import('../../main-content-v2/AlwaysOnV2'));
const FilesV2 = lazy(() => import('../../main-content-v2/FilesV2'));
const ShellV2 = lazy(() => import('../../main-content-v2/ShellV2'));
const GitV2 = lazy(() => import('../../main-content-v2/GitV2'));
const PluginTabContent = lazy(() => import('../../plugins/view/PluginTabContent'));
const DashboardV2 = lazy(() => import('../../main-content-v2/DashboardV2'));
const TasksV2 = lazy(() => import('../../main-content-v2/TasksV2'));
const SkillsV2 = lazy(() => import('../../main-content-v2/SkillsV2'));
const MemoryPanel = lazy(() => import('./memory/MemoryPanel'));
const EditorSidebar = lazy(() => import('../../code-editor/view/EditorSidebar'));

type TaskMasterContextValue = {
  currentProject?: Project | null;
  setCurrentProject?: ((project: Project) => void) | null;
};

type TasksSettingsContextValue = {
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  isTaskMasterReady: boolean | null;
};

type MainContentToast = { kind: 'error' | 'info'; text: string } | null;

const FILES_CHAT_DEFAULT_WIDTH = 460;
const FILES_CHAT_MIN_WIDTH = 320;
const FILES_TREE_MIN_WIDTH = 280;
const FILES_TREE_ONLY_WIDTH = 300;

type ConsolePageMeta = {
  title: string;
  description: string;
  icon: LucideIcon;
};

function getConsolePageMeta(
  activeTab: string,
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): ConsolePageMeta {
  const projectLabel = selectedProject?.displayName || selectedProject?.name || '未选择项目';
  const sessionLabel = selectedSession?.title || selectedSession?.summary || selectedSession?.id;

  if (activeTab === 'chat') {
    return {
      title: sessionLabel ? '会话' : '会话工作台',
      description: sessionLabel ? `${projectLabel} / ${sessionLabel}` : `${projectLabel} 的智能代理工作区`,
      icon: MessageSquare,
    };
  }

  if (activeTab === 'sessions') {
    return {
      title: '会话列表',
      description: '查看所有项目的最近会话、未读和运行状态',
      icon: MessageSquare,
    };
  }

  if (activeTab === 'projects') {
    return {
      title: '项目列表',
      description: '查看所有项目、最近活动和会话数量',
      icon: FolderOpen,
    };
  }

  if (activeTab === 'files') {
    return {
      title: '项目文件',
      description: `${projectLabel} 的文件树、编辑器和会话协作视图`,
      icon: FolderOpen,
    };
  }

  if (activeTab === 'always-on') {
    return {
      title: '后台任务',
      description: `${projectLabel} 的 Always-On 计划、运行记录和定时任务`,
      icon: Zap,
    };
  }

  if (activeTab === 'dashboard') {
    return {
      title: '数据与路由',
      description: '查看模型路由、成本、令牌和项目级使用趋势',
      icon: BarChart3,
    };
  }

  if (activeTab === 'memory') {
    return {
      title: '记忆',
      description: `${projectLabel} 的白盒记忆、检索上下文和知识沉淀`,
      icon: Brain,
    };
  }

  if (activeTab === 'skills') {
    return {
      title: '插件与 Skills',
      description: `${projectLabel} 可用的能力扩展、工具和 Skill 管理`,
      icon: Puzzle,
    };
  }

  if (activeTab === 'tasks') {
    return {
      title: '任务',
      description: `${projectLabel} 的 TaskMaster 任务列表和执行状态`,
      icon: Wrench,
    };
  }

  if (activeTab === 'shell') {
    return {
      title: '终端',
      description: `${projectLabel} 的 Shell 执行环境`,
      icon: Terminal,
    };
  }

  if (activeTab === 'git') {
    return {
      title: 'Git',
      description: `${projectLabel} 的变更、提交和版本控制`,
      icon: GitBranch,
    };
  }

  if (activeTab.startsWith('plugin:')) {
    return {
      title: activeTab.replace('plugin:', ''),
      description: `${projectLabel} 的插件页面`,
      icon: Puzzle,
    };
  }

  return {
    title: '工作台',
    description: projectLabel,
    icon: Wrench,
  };
}

function ConsolePageFrame({
  meta,
  children,
  dense = false,
  centered = false,
}: {
  meta: ConsolePageMeta;
  children: React.ReactNode;
  dense?: boolean;
  centered?: boolean;
}) {
  const Icon = meta.icon;

  return (
    <div className="flex h-full min-w-0 flex-1 overflow-hidden bg-surface-50 text-surface-900 dark:bg-surface-950 dark:text-surface-100">
      <div
        className={cn(
          'flex h-full min-h-0 flex-col px-4 py-4 lg:px-6 lg:py-5',
          centered && 'mx-auto w-full max-w-6xl',
        )}
      >
        <div className="mb-4 flex shrink-0 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
              <Icon className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold tracking-tight text-surface-900 dark:text-surface-100">
                {meta.title}
              </h1>
              <p className="mt-0.5 truncate text-sm text-surface-500 dark:text-surface-400">
                {meta.description}
              </p>
            </div>
          </div>
        </div>
        <div
          className={cn(
            'min-h-0 flex-1 overflow-hidden rounded-xl border border-surface-200 bg-white shadow-sm shadow-surface-200/40 dark:border-surface-800 dark:bg-surface-900 dark:shadow-black/20',
            dense && 'rounded-lg',
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function PaneFallback({ label = '加载中...' }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[160px] items-center justify-center px-4 text-sm text-surface-500 dark:text-surface-400">
      {label}
    </div>
  );
}

async function readJsonPayload<T>(response: Response): Promise<T | null> {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

function MainContent({
  projects,
  selectedProject,
  selectedSession,
  activeTab,
  setActiveTab,
  alwaysOnSubTab = 'dashboard',
  onAlwaysOnSubTabChange,
  ws,
  isConnected = true,
  sendMessage,
  latestMessage,
  isMobile,
  onMenuClick,
  isLoading,
  onInputFocusChange,
  onSessionActive,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  onSessionActivityBump,
  processingSessions,
  unreadSessionIds,
  onReplaceTemporarySession,
  onNavigateToSession,
  onStartNewSession,
  onSelectSession,
  onShowSettings,
  onCreateProject,
  onSelectProjectByName,
  homeDashboardData,
  routingDashboardData,
  externalMessageUpdate,
}: MainContentProps) {
  const { i18n } = useTranslation();
  const { preferences } = useUiPreferences();
  const { autoExpandTools, showRawParameters, showThinking, autoScrollToBottom, sendByCtrlEnter } = preferences;

  const { currentProject, setCurrentProject } = useTaskMaster() as TaskMasterContextValue;
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings() as TasksSettingsContextValue;
  const lastUserMsgAtRef = useRef<string | null>(null);
  const [toast, setToast] = useState<MainContentToast>(null);

  const shouldShowTasksTab = Boolean(tasksEnabled && isTaskMasterInstalled);

  const {
    editingFile,
    editorWidth,
    editorExpanded,
    hasManualWidth,
    resizeHandleRef,
    handleFileOpen,
    handleCloseEditor,
    handleToggleEditorExpand,
    handleResizeStart,
  } = useEditorSidebar({
    selectedProject,
    isMobile,
  });

  useEffect(() => {
    const selectedProjectName = selectedProject?.name;
    const currentProjectName = currentProject?.name;

    if (selectedProject && selectedProjectName !== currentProjectName) {
      setCurrentProject?.(selectedProject);
    }
  }, [selectedProject, currentProject?.name, setCurrentProject]);

  useEffect(() => {
    if (!shouldShowTasksTab && activeTab === 'tasks') {
      setActiveTab('chat');
    }
  }, [shouldShowTasksTab, activeTab, setActiveTab]);

  const refreshProjectsSilently = useCallback(() => {
    if (window.refreshProjects) {
      void window.refreshProjects();
    }
  }, []);

  const trackedSendMessage = useCallback((message: unknown) => {
    if (
      message &&
      typeof message === 'object' &&
      'type' in message &&
      ['claude-command', 'cursor-command', 'codex-command', 'gemini-command','pilotdeck-command'].includes(
        String((message as { type?: unknown }).type),
      )
    ) {
      lastUserMsgAtRef.current = new Date().toISOString();
    }
    return sendMessage(message);
  }, [sendMessage]);

  const publishPresence = useCallback(() => {
    const alwaysOnProjects = projects.filter(project =>
      project.alwaysOn?.discovery?.triggerEnabled === true
    );
    if (!selectedProject && alwaysOnProjects.length === 0) {
      return;
    }
    sendAlwaysOnPresence(sendMessage, {
      selectedProject,
      alwaysOnProjects,
      processingSessionIds: Array.from(processingSessions),
      lastUserMsgAt: lastUserMsgAtRef.current,
    });
  }, [processingSessions, projects, selectedProject, sendMessage]);

  useEffect(() => {
    const hasAlwaysOnProject = projects.some(project =>
      project.alwaysOn?.discovery?.triggerEnabled === true
    );
    if (!ws || (!selectedProject && !hasAlwaysOnProject)) {
      return undefined;
    }

    publishPresence();
    const timer = window.setInterval(publishPresence, 30000);
    return () => {
      window.clearInterval(timer);
      clearAlwaysOnPresence(sendMessage);
    };
  }, [projects, publishPresence, selectedProject, sendMessage, ws]);

  const applyAndLaunchCycle = useCallback(async (
    projectName: string,
    cycleId: string,
  ) => {
    const response = await api.applyWorkCycle(projectName, cycleId);
    const payload = await readJsonPayload<{ cycle?: { id: string }; sessionKey?: string; executionToken?: string; error?: { code: string; message: string } | string }>(response);
    if (!response.ok || !payload) {
      const errMsg = typeof payload?.error === 'string' ? payload.error : payload?.error?.message;
      throw new Error(errMsg || '提交 discovery 计划执行失败');
    }
    if (payload.error) {
      const errMsg = typeof payload.error === 'string' ? payload.error : payload.error.message;
      throw new Error(errMsg);
    }

    refreshProjectsSilently();
  }, [refreshProjectsSilently]);

  const flashToast = useCallback((toastValue: MainContentToast, ms = 2400) => {
    setToast(toastValue);
    if (toastValue) {
      window.setTimeout(() => setToast(null), ms);
    }
  }, []);

  const getProjectSessions = useCallback((project: Project): ProjectSession[] =>
    project.sessions ?? [],
  []);

  const findSessionInProject = useCallback((project: Project, sessionId: string) => (
    getProjectSessions(project).find((session) => session.id === sessionId)
  ), [getProjectSessions]);

  const loadPilotDeckSession = useCallback(async (projectName: string, sessionId: string) => {
    const response = await api.sessions(projectName, Number.MAX_SAFE_INTEGER, 0);
    if (!response.ok) {
      return null;
    }
    const payload = await readJsonPayload<{ sessions?: ProjectSession[] }>(response);
    return payload?.sessions?.find((session) => session.id === sessionId) ?? null;
  }, []);

  const handleOpenAlwaysOnSession = useCallback(async (target: AlwaysOnSessionTarget) => {
    if (!selectedProject) {
      return;
    }

      const missingMessage = i18n.t('alwaysOn:sessionMissing', {
      defaultValue: '这条聊天记录已不存在。',
    });

    if (target.kind === 'origin') {
      const lookupProjectName = target.projectName || selectedProject.name;
      const targetProject =
        target.projectName && target.projectName !== selectedProject.name
          ? projects.find((p) => p.name === target.projectName) ?? selectedProject
          : selectedProject;

      const existingSession =
        findSessionInProject(targetProject, target.sessionId) ??
        await loadPilotDeckSession(lookupProjectName, target.sessionId);

      if (!existingSession) {
        flashToast({ kind: 'error', text: missingMessage });
        return;
      }

      const fallbackSession: ProjectSession = {
        ...existingSession,
        __projectName: lookupProjectName,
      };

      setActiveTab('chat');
      if (onSelectSession) {
        onSelectSession(targetProject, target.sessionId, fallbackSession);
        return;
      }
      onNavigateToSession(target.sessionId);
      return;
    }

    const existingSession =
      findSessionInProject(selectedProject, target.sessionId) ??
      await loadPilotDeckSession(selectedProject.name, target.sessionId);

    if (!existingSession) {
      flashToast({ kind: 'error', text: missingMessage });
      return;
    }

    const fallbackSession: ProjectSession = {
      ...existingSession,
      id: target.sessionId,
      title: target.title || existingSession.title || existingSession.summary || target.summary,
      summary: target.summary || existingSession.summary || existingSession.title || target.title,
      lastActivity: target.lastActivity || existingSession.lastActivity,
      sessionKind: 'background_task',
      parentSessionId: target.parentSessionId,
      relativeTranscriptPath: target.relativeTranscriptPath,
      transcriptKey: target.transcriptKey || existingSession.transcriptKey,
      taskId: target.taskId || existingSession.taskId,
      taskStatus: target.taskStatus || existingSession.taskStatus,
      outputFile: target.outputFile || existingSession.outputFile,
      isReadOnly: true,
      __projectName: selectedProject.name,
    };

    setActiveTab('chat');
    if (onSelectSession) {
      onSelectSession(selectedProject, target.sessionId, fallbackSession);
      return;
    }
    onNavigateToSession(target.sessionId);
  }, [
    findSessionInProject,
    flashToast,
    i18n,
    loadPilotDeckSession,
    onNavigateToSession,
    onSelectSession,
    projects,
    selectedProject,
    setActiveTab,
  ]);

  const handleOpenExecutionSession = useCallback(
    (projectKey: string, runId: string, projectName?: string) => {
      const rawId = `always-on/execute:project=${projectKey}:run=${runId}`;
      const sessionId = rawId.replace(/[\\/]+/g, '-').replace(/^-+|-+$/g, '') || 'session';
      void handleOpenAlwaysOnSession({ kind: 'origin', sessionId, projectName });
    },
    [handleOpenAlwaysOnSession],
  );

  if (isLoading && activeTab !== 'home') {
    return (
      <MainContentStateView
        mode="loading"
        isMobile={isMobile}
        onMenuClick={onMenuClick}
      />
    );
  }

  if (!selectedProject && activeTab !== 'dashboard' && activeTab !== 'home' && activeTab !== 'sessions' && activeTab !== 'projects') {
    return (
      <MainContentStateView
        mode="empty"
        isMobile={isMobile}
        onMenuClick={onMenuClick}
      />
    );
  }

  return (
    <div className="relative flex h-full flex-col bg-surface-50 text-surface-900 dark:bg-surface-950 dark:text-surface-100">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <SplitBody
          projects={projects}
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          activeTab={activeTab}
          shouldShowTasksTab={shouldShowTasksTab}
          tasksEnabled={tasksEnabled}
          setActiveTab={setActiveTab}
          alwaysOnSubTab={alwaysOnSubTab}
          onAlwaysOnSubTabChange={onAlwaysOnSubTabChange}
          ws={ws}
          isConnected={isConnected}
          sendMessage={trackedSendMessage}
          latestMessage={latestMessage}
          handleFileOpen={handleFileOpen}
          onInputFocusChange={onInputFocusChange}
          onSessionActive={onSessionActive}
          onSessionInactive={onSessionInactive}
          onSessionProcessing={onSessionProcessing}
          onSessionNotProcessing={onSessionNotProcessing}
          onSessionActivityBump={onSessionActivityBump}
          processingSessions={processingSessions}
          unreadSessionIds={unreadSessionIds ?? new Set<string>()}
          homeDashboardData={homeDashboardData}
          routingDashboardData={routingDashboardData}
          onReplaceTemporarySession={onReplaceTemporarySession}
          onNavigateToSession={onNavigateToSession}
          onStartNewSession={onStartNewSession}
          onSelectSession={onSelectSession}
          onShowSettings={onShowSettings}
          onCreateProject={onCreateProject}
          externalMessageUpdate={externalMessageUpdate}
          autoExpandTools={autoExpandTools}
          showRawParameters={showRawParameters}
          showThinking={showThinking}
          autoScrollToBottom={autoScrollToBottom}
          sendByCtrlEnter={sendByCtrlEnter}
          applyAndLaunchCycle={applyAndLaunchCycle}
          handleOpenExecutionSession={handleOpenExecutionSession}
          editorExpanded={editorExpanded}
          hasEditor={editingFile !== null}
          onSelectProjectByName={onSelectProjectByName}
        />

        {selectedProject && editingFile ? (
          <Suspense fallback={<PaneFallback label="加载编辑器..." />}>
            <EditorSidebar
              editingFile={editingFile}
              isMobile={isMobile}
              editorExpanded={editorExpanded}
              editorWidth={editorWidth}
              hasManualWidth={hasManualWidth}
              resizeHandleRef={resizeHandleRef}
              onResizeStart={handleResizeStart}
              onCloseEditor={handleCloseEditor}
              onToggleEditorExpand={handleToggleEditorExpand}
              projectPath={selectedProject.path}
              fillSpace={activeTab === 'files'}
            />
          </Suspense>
        ) : null}
      </div>
      {toast ? (
        <div
          className={cn(
            'pointer-events-none absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md px-3 py-1.5 text-[12px] shadow-lg',
            toast.kind === 'error' && 'bg-red-600 text-white',
            toast.kind === 'info' && 'bg-neutral-800 text-white',
          )}
        >
          {toast.text}
        </div>
      ) : null}
    </div>
  );
}

// V2 split body: the Agent surface owns both the new-session welcome state
// and existing transcripts. Files can pair with Agent in split view; focused
// tools such as Always-On, Dashboard, Tasks, and Memory render full-screen.
type SplitBodyProps = {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: any;
  activeTab: string;
  shouldShowTasksTab: boolean;
  tasksEnabled: boolean;
  setActiveTab: (tab: any) => void;
  alwaysOnSubTab: MainContentProps['alwaysOnSubTab'];
  onAlwaysOnSubTabChange: MainContentProps['onAlwaysOnSubTabChange'];
  ws: any;
  isConnected?: boolean;
  sendMessage: any;
  latestMessage: any;
  handleFileOpen: (filePath: string, diffInfo?: CodeEditorDiffInfo | null) => void;
  onInputFocusChange: any;
  onSessionActive: any;
  onSessionInactive: any;
  onSessionProcessing: any;
  onSessionNotProcessing: any;
  onSessionActivityBump?: (
    projectName: string,
    sessionId: string,
    optimisticTitle?: string,
  ) => void;
  processingSessions: any;
  unreadSessionIds: Set<string>;
  homeDashboardData?: HomeDashboardData;
  routingDashboardData?: DashboardData | null;
  onReplaceTemporarySession: any;
  onNavigateToSession: (sessionId: string) => void;
  onStartNewSession: (project: Project) => void;
  onSelectSession?: (project: Project, sessionId: string, fallbackSession?: ProjectSession) => void;
  onShowSettings: any;
  onCreateProject?: () => void;
  externalMessageUpdate: any;
  autoExpandTools: any;
  showRawParameters: any;
  showThinking: any;
  autoScrollToBottom: any;
  sendByCtrlEnter: any;
  applyAndLaunchCycle: (projectName: string, cycleId: string) => Promise<void>;
  handleOpenExecutionSession: (projectKey: string, runId: string, projectName?: string) => void;
  editorExpanded: boolean;
  hasEditor: boolean;
  onSelectProjectByName?: (projectName: string) => void;
};

function SplitBody(props: SplitBodyProps) {
  const {
    projects,
    selectedProject,
    selectedSession,
    activeTab,
    shouldShowTasksTab,
    tasksEnabled,
    setActiveTab,
    alwaysOnSubTab = 'dashboard',
    onAlwaysOnSubTabChange,
    ws,
    isConnected = true,
    sendMessage,
    latestMessage,
    handleFileOpen,
    onInputFocusChange,
    onSessionActive,
    onSessionInactive,
    onSessionProcessing,
    onSessionNotProcessing,
    onSessionActivityBump,
    processingSessions,
    unreadSessionIds,
    homeDashboardData,
    routingDashboardData,
    onReplaceTemporarySession,
    onNavigateToSession,
    onStartNewSession,
    onSelectSession,
    onShowSettings,
    onCreateProject,
    externalMessageUpdate,
    autoExpandTools,
    showRawParameters,
    showThinking,
    autoScrollToBottom,
    sendByCtrlEnter,
    applyAndLaunchCycle,
    handleOpenExecutionSession,
    editorExpanded,
    hasEditor,
    onSelectProjectByName,
  } = props;

  // Render-mode taxonomy:
  //   - 'chat':    Agent surface. No session shows the welcome composer;
  //                existing sessions show the transcript.
  //   - 'split':   Files tab only. Chat on the left, file tree/editor on right.
  //   - 'tool':    Always-On / Dashboard / Memory / Tasks / Shell / Git /
  //                plugin tabs. Tool fills the whole main area, no chat
  //                alongside — matches the legacy single-pane layout users
  //                expect when they tab into a focused tool.
  //
  // Note: Shell + Git aren't surfaced in the V2 top tab bar (see TABS in
  // MainAreaV2.tsx) but plugins / programmatic activeTab values still hit
  // those code paths, so we keep them here as full-screen tool views.
  const isPlugin = typeof activeTab === 'string' && activeTab.startsWith('plugin:');
  const fullScreenToolTabs = new Set([
    'shell',
    'home',
    'sessions',
    'projects',
    'git',
    'always-on',
    'dashboard',
    'memory',
    'skills',
    'tasks',
  ]);
  const isFullScreenTool = fullScreenToolTabs.has(activeTab) || isPlugin;
  // Tasks tab is conditional — fall back to chat if the project hasn't
  // enabled it yet so we don't render a black hole.
  const renderTasksAsTool = activeTab === 'tasks' && shouldShowTasksTab;
  const isFiles = activeTab === 'files';
  const filesSplitContainerRef = useRef<HTMLDivElement | null>(null);
  const [filesChatWidth, setFilesChatWidth] = useState(FILES_CHAT_DEFAULT_WIDTH);
  const [isFilesSplitResizing, setIsFilesSplitResizing] = useState(false);
  const pageMeta = useMemo(
    () => getConsolePageMeta(activeTab, selectedProject, selectedSession),
    [activeTab, selectedProject, selectedSession],
  );

  const clampFilesChatWidth = useCallback((width: number, containerWidth: number) => {
    const maxWidth = Math.max(FILES_CHAT_MIN_WIDTH, containerWidth - FILES_TREE_MIN_WIDTH);
    return Math.min(Math.max(width, FILES_CHAT_MIN_WIDTH), maxWidth);
  }, []);

  useEffect(() => {
    if (!isFiles) return;
    const container = filesSplitContainerRef.current;
    if (!container) return;
    const containerWidth = container.getBoundingClientRect().width;
    if (hasEditor) {
      setFilesChatWidth(FILES_CHAT_DEFAULT_WIDTH);
    } else {
      setFilesChatWidth(Math.max(FILES_CHAT_MIN_WIDTH, containerWidth - FILES_TREE_ONLY_WIDTH));
    }
  }, [hasEditor, isFiles]);

  const handleFilesSplitResizeStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!isFiles) {
      return;
    }

    setIsFilesSplitResizing(true);
    event.preventDefault();
  }, [isFiles]);

  useEffect(() => {
    if (!isFilesSplitResizing) {
      return undefined;
    }

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const container = filesSplitContainerRef.current;
      if (!container) {
        return;
      }

      const rect = container.getBoundingClientRect();
      setFilesChatWidth(clampFilesChatWidth(event.clientX - rect.left, rect.width));
    };

    const handleMouseUp = () => {
      setIsFilesSplitResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [clampFilesChatWidth, isFilesSplitResizing]);

  const handleSessionListSelect = useCallback(
    (project: Project, sessionId: string, fallbackSession?: ProjectSession) => {
      if (onSelectSession) {
        onSelectSession(project, sessionId, fallbackSession);
      } else {
        onNavigateToSession(sessionId);
      }
      setActiveTab('chat');
    },
    [onNavigateToSession, onSelectSession, setActiveTab],
  );

  const renderTool = () => {
    if (activeTab === 'home') {
      if (!homeDashboardData) return null;
      return (
        <HomeConsoleV2
          projects={projects}
          onSelectProjectByName={onSelectProjectByName}
          onSelectSession={onSelectSession}
          onStartNewSession={onStartNewSession}
          onCreateProject={onCreateProject}
          onShowSettings={onShowSettings}
          setActiveTab={setActiveTab}
          homeData={homeDashboardData}
          routingData={routingDashboardData}
        />
      );
    }
    if (activeTab === 'sessions') {
      return (
        <SessionsV2
          projects={projects}
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          unreadSessionIds={unreadSessionIds}
          processingSessions={processingSessions}
          onSelectSession={handleSessionListSelect}
          onStartNewSession={onStartNewSession}
          onCreateProject={onCreateProject}
        />
      );
    }
    if (activeTab === 'projects') {
      return (
        <ProjectsV2
          projects={projects}
          selectedProject={selectedProject}
          onSelectProject={(projectName) => {
            onSelectProjectByName?.(projectName);
          }}
          onCreateProject={onCreateProject}
        />
      );
    }
    if (activeTab === 'shell') {
      return (
        <ShellV2
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          isActive
        />
      );
    }
    if (activeTab === 'git') {
      return <GitV2 selectedProject={selectedProject} onFileOpen={handleFileOpen} />;
    }
    if (activeTab === 'always-on') {
      return (
        <AlwaysOnV2
          selectedProject={selectedProject}
          subTab={alwaysOnSubTab}
          onSubTabChange={onAlwaysOnSubTabChange ?? (() => undefined)}
          onApplyWorkCycle={applyAndLaunchCycle}
          onOpenExecutionSession={handleOpenExecutionSession}
        />
      );
    }
    if (activeTab === 'dashboard') return <DashboardV2 projectFilter={selectedProject?.name} projectFullPath={selectedProject?.fullPath} onSelectProject={onSelectProjectByName} />;
    if (activeTab === 'memory') return <MemoryPanel selectedProject={selectedProject} />;
    if (activeTab === 'skills') return <SkillsV2 selectedProject={selectedProject} projects={projects} />;
    if (renderTasksAsTool) return <TasksV2 isVisible />;
    if (isPlugin) {
      return (
        <PluginTabContent
          pluginName={activeTab.replace('plugin:', '')}
          selectedProject={selectedProject}
          selectedSession={selectedSession}
        />
      );
    }
    return null;
  };

  const showFullScreenTool = isFullScreenTool && (activeTab !== 'tasks' || shouldShowTasksTab);
  const showChat = !showFullScreenTool;
  const keepHiddenChatMounted = showChat || (activeTab !== 'home' && selectedProject !== null);
  const showUnifiedFrame = showFullScreenTool && activeTab !== 'home';
  const shouldCenterToolFrame = new Set([
    'sessions',
    'projects',
    'always-on',
    'memory',
    'skills',
    'dashboard',
  ]).has(activeTab);

  return (
    <div
      ref={isFiles && showChat ? filesSplitContainerRef : undefined}
      className={cn('flex min-h-0 min-w-0 flex-1 overflow-hidden', editorExpanded && 'hidden')}
    >
      {/* Full-screen tool surface (Memory, Dashboard, Always-On, etc.) */}
      {showFullScreenTool && activeTab === 'home' ? (
        <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">
          <ErrorBoundary showDetails resetKeys={[activeTab, selectedProject?.name]}>
            {renderTool()}
          </ErrorBoundary>
        </div>
      ) : null}

      {showUnifiedFrame ? (
        <ConsolePageFrame meta={pageMeta} centered={shouldCenterToolFrame}>
          <div className="h-full min-h-0 overflow-hidden">
            <ErrorBoundary showDetails resetKeys={[activeTab, selectedProject?.name]}>
              <Suspense fallback={<PaneFallback />}>
                {renderTool()}
              </Suspense>
            </ErrorBoundary>
          </div>
        </ConsolePageFrame>
      ) : null}

      {/* Agent surface — kept mounted even when a full-screen tool is active
          so that the session store, WebSocket subscriptions, and streaming
          state survive tab switches. Hidden via CSS to avoid layout cost. */}
      {keepHiddenChatMounted ? (
        <div
          className={cn(
            'flex min-h-0 min-w-0 flex-col',
            showChat
              ? (isFiles ? 'flex-shrink-0 p-4 lg:p-5' : 'flex-1 p-4 lg:p-5')
              : 'invisible absolute h-0 w-0 overflow-hidden',
          )}
          style={showChat && isFiles
            ? {
                minWidth: `${FILES_CHAT_MIN_WIDTH}px`,
                width: `min(${filesChatWidth}px, calc(100% - ${FILES_TREE_MIN_WIDTH}px))`,
              }
            : undefined}
          aria-hidden={!showChat}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-surface-200 bg-white shadow-sm shadow-surface-200/40 dark:border-surface-800 dark:bg-surface-900 dark:shadow-black/20">
            <Suspense fallback={<PaneFallback label="加载会话..." />}>
              <ErrorBoundary showDetails>
                <ChatInterfaceV2
                  selectedProject={selectedProject}
                  selectedSession={selectedSession}
                  ws={ws}
                  isConnected={isConnected}
                  sendMessage={sendMessage}
                  latestMessage={latestMessage}
                  onFileOpen={handleFileOpen}
                  onInputFocusChange={onInputFocusChange}
                  onSessionActive={onSessionActive}
                  onSessionInactive={onSessionInactive}
                  onSessionProcessing={onSessionProcessing}
                  onSessionNotProcessing={onSessionNotProcessing}
                  onSessionActivityBump={onSessionActivityBump}
                  processingSessions={processingSessions}
                  onReplaceTemporarySession={onReplaceTemporarySession}
                  onNavigateToSession={onNavigateToSession}
                  onShowSettings={onShowSettings}
                  autoExpandTools={autoExpandTools}
                  showRawParameters={showRawParameters}
                  showThinking={showThinking}
                  autoScrollToBottom={autoScrollToBottom}
                  sendByCtrlEnter={sendByCtrlEnter}
                  externalMessageUpdate={externalMessageUpdate}
                  onShowAllTasks={tasksEnabled ? () => setActiveTab('tasks') : null}
                  forceWelcome={false}
                  onExitWelcome={() => setActiveTab('chat')}
                />
              </ErrorBoundary>
            </Suspense>
          </div>
        </div>
      ) : null}

      {/* Right half — only mounted when the user is on Files (chat-paired
          file tree + editor). */}
      {isFiles && showChat ? (
        <>
          <div
            onMouseDown={handleFilesSplitResizeStart}
            className="group relative z-10 w-px flex-shrink-0 cursor-col-resize bg-surface-200 transition-colors hover:bg-surface-400 dark:bg-surface-800 dark:hover:bg-surface-600"
            title="拖动调整大小"
          >
            <div className="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2" />
            <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-surface-400 opacity-0 transition-opacity group-hover:opacity-100 dark:bg-surface-600" />
          </div>
          <div
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-4 pl-0 lg:p-5 lg:pl-0"
            style={{ minWidth: `${FILES_TREE_MIN_WIDTH}px` }}
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-surface-200 bg-white shadow-sm shadow-surface-200/40 dark:border-surface-800 dark:bg-surface-900 dark:shadow-black/20">
              <Suspense fallback={<PaneFallback label="加载文件..." />}>
                <FilesV2
                  key={selectedProject?.name ?? ''}
                  selectedProject={selectedProject}
                  onFileOpen={handleFileOpen}
                  onClose={() => setActiveTab('chat')}
                />
              </Suspense>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default React.memo(MainContent);
