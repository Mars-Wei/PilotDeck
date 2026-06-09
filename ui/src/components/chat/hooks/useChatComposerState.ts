import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  SetStateAction,
  TouchEvent,
} from 'react';
import { useDropzone } from 'react-dropzone';
import { authenticatedFetch } from '../../../utils/api';
import { thinkingModes } from '../constants/thinkingModes';
import { grantPilotDeckToolPermission } from '../utils/chatPermissions';
import { safeLocalStorage } from '../utils/chatStorage';
import {
  createTemporarySessionId,
  getNotificationSessionSummary,
  isTemporarySessionId,
  startSessionCommand,
} from '../utils/sessionLauncher';
import type {
  ChatMessage,
  PendingPermissionRequest,
  PermissionMode,
} from '../types/types';
import type {
  Project,
  ProjectSession,
} from '../../../types/app';
import { escapeRegExp } from '../utils/chatFormatting';
import { isImeEnterEvent } from '../../../utils/ime';
import { useFileMentions } from './useFileMentions';
import { type SlashCommand, useSlashCommands } from './useSlashCommands';

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

interface UseChatComposerStateArgs {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  model: string;
  permissionMode: PermissionMode | string;
  cycleRunMode: () => void;
  isLoading: boolean;
  isChatConnected?: boolean;
  canAbortSession: boolean;
  tokenBudget: Record<string, unknown> | null;
  sendMessage: (message: unknown) => boolean;
  sendByCtrlEnter?: boolean;
  onSessionActive?: (sessionId?: string | null) => void;
  onSessionInactive?: (sessionId?: string | null) => void;
  onSessionProcessing?: (sessionId?: string | null) => void;
  onSessionActivityBump?: (
    projectName: string,
    sessionId: string,
    optimisticTitle?: string,
  ) => void;
  onInputFocusChange?: (focused: boolean) => void;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  pendingViewSessionRef: { current: PendingViewSession | null };
  scrollToBottom: () => void;
  addMessage: (msg: ChatMessage, targetSessionId?: string | null) => void;
  clearMessages: () => void;
  rewindMessages: (count: number) => void;
  setIsLoading: (loading: boolean) => void;
  setCanAbortSession: (canAbort: boolean) => void;
  setIsAborting: (aborting: boolean) => void;
  setClaudeStatus: (status: { text: string; tokens: number; can_interrupt: boolean } | null) => void;
  setPilotDeckStatus: (status: { text: string; tokens: number; can_interrupt: boolean } | null) => void;
  setIsUserScrolledUp: (isScrolledUp: boolean) => void;
  pendingPermissionRequests: PendingPermissionRequest[];
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
}

interface MentionableFile {
  name: string;
  path: string;
}

interface CommandExecutionResult {
  type: 'builtin' | 'custom';
  action?: string;
  data?: any;
  content?: string;
  hasBashCommands?: boolean;
  hasFileIncludes?: boolean;
  // Set by /api/commands/execute for bundled-skill stubs and on-disk
  // SKILL.md commands. When passthrough=true, the frontend re-submits the
  // raw `/<name> <args>` text as user input so the agent's SkillTool runs it.
  metadata?: {
    type?: string;
    passthrough?: boolean;
    [key: string]: unknown;
  };
  command?: string;
}

const createFakeSubmitEvent = () => {
  return { preventDefault: () => undefined } as unknown as FormEvent<HTMLFormElement>;
};

const MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const HOME_PROMPT_STORAGE_KEY = 'pilotdeck-home-pending-prompt';
const HOME_PROMPT_AUTOSUBMIT_STORAGE_KEY = 'pilotdeck-home-pending-prompt-autosubmit';

type UploadedAttachmentFile = {
  name: string;
  path: string;
  size?: number;
  mimeType?: string;
};

export function shouldCycleRunModeOnKeyDown(
  event: Pick<KeyboardEvent<HTMLTextAreaElement>, 'key' | 'shiftKey'>,
  {
    showFileDropdown,
    showCommandMenu,
  }: {
    showFileDropdown: boolean;
    showCommandMenu: boolean;
  },
): boolean {
  return event.key === 'Tab' && event.shiftKey && !showFileDropdown && !showCommandMenu;
}

function buildAttachmentPathNote(files: UploadedAttachmentFile[]): string {
  if (!files.length) {
    return '';
  }

  const lines = files.map((file) => `- ${file.name}: ${file.path}`);
  return `\n\n[Files attached by user and available for reading in the project:]\n${lines.join('\n')}`;
}

export function useChatComposerState({
  selectedProject,
  selectedSession,
  currentSessionId,
  model,
  permissionMode,
  cycleRunMode,
  isLoading,
  isChatConnected = true,
  canAbortSession,
  tokenBudget,
  sendMessage,
  sendByCtrlEnter,
  onSessionActive,
  onSessionInactive,
  onSessionProcessing,
  onSessionActivityBump,
  onInputFocusChange,
  onFileOpen,
  onShowSettings,
  pendingViewSessionRef,
  scrollToBottom,
  addMessage,
  clearMessages,
  rewindMessages,
  setIsLoading,
  setCanAbortSession,
  setIsAborting,
  setClaudeStatus,
  setPilotDeckStatus,
  setIsUserScrolledUp,
  pendingPermissionRequests,
  setPendingPermissionRequests,
}: UseChatComposerStateArgs) {
  const [input, setInput] = useState(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      return safeLocalStorage.getItem(`draft_input_${selectedProject.name}`) || '';
    }
    return '';
  });
  const [attachedImages, setAttachedImages] = useState<File[]>([]);
  const [uploadingImages, setUploadingImages] = useState<Map<string, number>>(new Map());
  const [imageErrors, setImageErrors] = useState<Map<string, string>>(new Map());
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);
  const [thinkingMode, setThinkingMode] = useState('none');
  const [pendingHomeAutoSubmit, setPendingHomeAutoSubmit] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputHighlightRef = useRef<HTMLDivElement>(null);
  const handleSubmitRef = useRef<
    ((event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>) => Promise<void>) | null
  >(null);
  const inputValueRef = useRef(input);
  const submitInFlightRef = useRef(false);
  const pendingHomeAutoSubmitRef = useRef<string | null>(null);
  const homePromptDraftGuardRef = useRef<{ projectName: string | null; prompt: string } | null>(null);

  // One-shot flag set by `handleCustomCommand` when re-submitting passthrough
  // slash content (e.g. `/projects` for bundled stubs, `/canvas` for skills).
  // Without this, handleSubmit would see the leading `/`, match the command
  // again, call executeCommand, get the same passthrough back, and loop —
  // user-visibly: the input keeps deleting/refilling.
  const skipSlashDetectionOnceRef = useRef(false);

  const handleBuiltInCommand = useCallback(
    async (result: CommandExecutionResult) => {
      const { action, data } = result;
      switch (action) {
        case 'clear':
          clearMessages();
          break;

        case 'help':
          addMessage({
            type: 'assistant',
            content: data.content,
            timestamp: Date.now(),
          });
          break;

        case 'model': {
          const modelLines = [`**当前模型**：${data.current.model}`, '', '**可用模型**：'];
          if (data.available && typeof data.available === 'object') {
            for (const [provider, models] of Object.entries(data.available)) {
              if (Array.isArray(models) && models.length) {
                modelLines.push('', `${provider}: ${models.join(', ')}`);
              }
            }
          }
          addMessage({
            type: 'assistant',
            content: modelLines.join('\n'),
            timestamp: Date.now(),
          });
          break;
        }

        case 'cost': {
          const costMessage = `**令牌用量**：${data.tokenUsage.used.toLocaleString()} / ${data.tokenUsage.total.toLocaleString()} (${data.tokenUsage.percentage}%)\n\n**预估成本**：\n- 输入：$${data.cost.input}\n- 输出：$${data.cost.output}\n- **总计**：$${data.cost.total}\n\n**模型**：${data.model}`;
          addMessage({ type: 'assistant', content: costMessage, timestamp: Date.now() });
          break;
        }

        case 'status': {
          const statusMessage = `**系统状态**\n\n- 版本：${data.version}\n- 运行时长：${data.uptime}\n- 模型：${data.model}\n- 供应商：${data.provider}\n- Node.js：${data.nodeVersion}\n- 平台：${data.platform}`;
          addMessage({ type: 'assistant', content: statusMessage, timestamp: Date.now() });
          break;
        }

        case 'memory':
          if (data.error) {
            addMessage({
              type: 'assistant',
              content: `警告：${data.message}`,
              timestamp: Date.now(),
            });
          } else {
            addMessage({
              type: 'assistant',
              content: `${data.message}\n\n路径：\`${data.path}\``,
              timestamp: Date.now(),
            });
            if (data.exists && onFileOpen) {
              onFileOpen(data.path);
            }
          }
          break;

        case 'config':
          onShowSettings?.();
          break;

        case 'rewind':
          if (data.error) {
            addMessage({
              type: 'assistant',
              content: `警告：${data.message}`,
              timestamp: Date.now(),
            });
          } else {
            rewindMessages(data.steps * 2);
            addMessage({
              type: 'assistant',
              content: `已回退 ${data.steps} 步。${data.message}`,
              timestamp: Date.now(),
            });
          }
          break;

        case 'skillInstall': {
          if (data.error) {
            addMessage({
              type: 'assistant',
              content: `**Skill install failed**\n\n${data.message || data.errorMessage || 'Unknown error'}${
                data.stderr ? `\n\n\`\`\`\n${data.stderr}\n\`\`\`` : ''
              }`,
              timestamp: Date.now(),
            });
            break;
          }
          const lines: string[] = [];

          if (data.needsForce) {
            lines.push(
              `⚠️ **\`${data.slug}\` 被 VirusTotal 标记为可疑。** clawhub 需要明确确认后才会安装。`,
            );
            lines.push('');
            lines.push('请先检查这个技能。如果你信任来源，可以重新运行：');
            lines.push('');
            lines.push('```');
            lines.push(data.retryCommand || `/skill_install ${data.slug} --force`);
            lines.push('```');
          } else if (data.installed) {
            const versionTag = data.skillMeta?.version ? ` v${data.skillMeta.version}` : '';
            const displayName = data.skillMeta?.name || data.slug;
            lines.push(`✅ **已安装** \`${displayName}\`${versionTag}（${data.scope === 'project' ? '项目' : '用户'}范围）`);
            lines.push(`路径：\`${data.installPath}\``);
            if (data.skillMeta?.description) {
              lines.push('');
              lines.push(data.skillMeta.description);
            }
          } else {
            lines.push(
              `⚠️ clawhub 已完成，但在 \`${data.installPath}\` 未找到 \`SKILL.md\`。`,
            );
          }

          if (data.stdout) {
            lines.push('');
            lines.push('```');
            lines.push(data.stdout);
            lines.push('```');
          }
          if (data.stderr) {
            lines.push('');
            lines.push('**stderr**');
            lines.push('```');
            lines.push(data.stderr);
            lines.push('```');
          }
          if (data.exitCode && data.exitCode !== 0 && !data.needsForce) {
            lines.push('');
            lines.push(`退出码：\`${data.exitCode}\`。${data.errorMessage || ''}`);
          }
          if (data.installed) {
            lines.push('');
            lines.push('_新技能已写入磁盘。打开新会话（或运行 `/clear-caches`）后 OPC Brain 会识别它；下次打开 `/` 时，UI 斜杠菜单也会加载它。_');
          }
          addMessage({
            type: 'assistant',
            content: lines.join('\n'),
            timestamp: Date.now(),
          });
          break;
        }

        case 'switchProject': {
          // The server validates that an arg was supplied; project lookup
          // happens here because the client already holds the projects list.
          // window.switchProject is registered by AppShellV2 and returns
          // false when no project matches, letting us surface a helpful
          // "not found" message in chat without leaving the page.
          if (data.error) {
            addMessage({
              type: 'assistant',
              content: data.message,
              timestamp: Date.now(),
            });
            break;
          }
          const targetName = String(data.projectName ?? '').trim();
          const switched =
            typeof window !== 'undefined' && typeof window.switchProject === 'function'
              ? window.switchProject(targetName)
              : false;
          addMessage({
            type: 'assistant',
            content: switched
              ? `已切换到项目：\`${targetName}\``
              : `没有匹配到项目 \`${targetName}\`。可以试试项目目录名（侧边栏提示中可见）。`,
            timestamp: Date.now(),
          });
          break;
        }

        default:
          console.warn('Unknown built-in command action:', action);
      }
    },
    [
      onFileOpen,
      onShowSettings,
      addMessage,
      clearMessages,
      rewindMessages,
    ],
  );

  const handleCustomCommand = useCallback(async (result: CommandExecutionResult) => {
    const { content, hasBashCommands, metadata } = result;

    if (hasBashCommands) {
      const confirmed = window.confirm(
        'This command contains bash commands that will be executed. Do you want to proceed?',
      );
      if (!confirmed) {
        addMessage({
          type: 'assistant',
          content: 'Command execution cancelled',
          timestamp: Date.now(),
        });
        return;
      }
    }

    const commandContent = content || '';
    setInput(commandContent);
    inputValueRef.current = commandContent;

    // Passthrough commands (bundled-skill stubs, on-disk skills) return their
    // own slash text as `content`. Suppress the next handleSubmit's slash
    // re-detection, otherwise it loops: detect /, executeCommand, passthrough,
    // setInput, submit, detect /, ... See skipSlashDetectionOnceRef.
    if (metadata && (metadata as { passthrough?: unknown }).passthrough) {
      skipSlashDetectionOnceRef.current = true;
    }

    // Defer submit to next tick so the command text is reflected in UI before dispatching.
    setTimeout(() => {
      if (handleSubmitRef.current) {
        handleSubmitRef.current(createFakeSubmitEvent());
      }
    }, 0);
  }, [addMessage]);

  const executeCommand = useCallback(
    async (command: SlashCommand, rawInput?: string) => {
      if (!command || !selectedProject) {
        return;
      }

      try {
        const effectiveInput = rawInput ?? input;
        const commandMatch = effectiveInput.match(new RegExp(`${escapeRegExp(command.name)}\\s*(.*)`));
        const args =
          commandMatch && commandMatch[1] ? commandMatch[1].trim().split(/\s+/) : [];

        const context = {
          projectPath: selectedProject.fullPath || selectedProject.path,
          projectName: selectedProject.name,
          sessionId: currentSessionId,
          model,
          tokenUsage: tokenBudget,
        };

        const response = await authenticatedFetch('/api/commands/execute', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            commandName: command.name,
            commandPath: command.path,
            args,
            context,
          }),
        });

        if (!response.ok) {
          let errorMessage = `Failed to execute command (${response.status})`;
          try {
            const errorData = await response.json();
            errorMessage = errorData?.message || errorData?.error || errorMessage;
          } catch {
            // Ignore JSON parse failures and use fallback message.
          }
          throw new Error(errorMessage);
        }

        const result = (await response.json()) as CommandExecutionResult;
        if (result.type === 'builtin') {
          await handleBuiltInCommand(result);
          setInput('');
          inputValueRef.current = '';
        } else if (result.type === 'custom') {
          await handleCustomCommand(result);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error executing command:', error);
        addMessage({
          type: 'assistant',
          content: `Error executing command: ${message}`,
          timestamp: Date.now(),
        });
      }
    },
    [
      model,
      currentSessionId,
      handleBuiltInCommand,
      handleCustomCommand,
      input,
      selectedProject,
      addMessage,
      tokenBudget,
    ],
  );

  const {
    slashCommands,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    dismissCommandMenu,
    handleCommandSelect,
    handleToggleCommandMenu,
    handleCommandInputChange,
    handleCommandMenuKeyDown,
  } = useSlashCommands({
    selectedProject,
    input,
    setInput,
    textareaRef,
    onExecuteCommand: executeCommand,
  });

  const {
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    setCursorPosition,
    handleFileMentionsKeyDown,
  } = useFileMentions({
    selectedProject,
    input,
    setInput,
    textareaRef,
  });

  const syncInputOverlayScroll = useCallback((target: HTMLTextAreaElement) => {
    if (!inputHighlightRef.current || !target) {
      return;
    }
    inputHighlightRef.current.scrollTop = target.scrollTop;
    inputHighlightRef.current.scrollLeft = target.scrollLeft;
  }, []);

  const handleImageFiles = useCallback((files: File[]) => {
    const validFiles = files.filter((file) => {
      try {
        if (!file || typeof file !== 'object') {
          console.warn('Invalid file object:', file);
          return false;
        }

        if (typeof file.size !== 'number' || file.size > MAX_ATTACHMENT_SIZE_BYTES) {
          const fileName = file.name || 'Unknown file';
          setImageErrors((previous) => {
            const next = new Map(previous);
            next.set(fileName, 'File too large (max 20MB)');
            return next;
          });
          return false;
        }

        return true;
      } catch (error) {
        console.error('Error validating file:', error, file);
        return false;
      }
    });

    if (validFiles.length > 0) {
      setAttachedImages((previous) => [...previous, ...validFiles].slice(0, MAX_ATTACHMENTS));
    }
  }, []);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData.items);

      const pastedFiles: File[] = [];

      items.forEach((item) => {
        if (item.kind !== 'file') return;
        const file = item.getAsFile();
        if (file) {
          pastedFiles.push(file);
        }
      });

      if (pastedFiles.length > 0) {
        handleImageFiles(pastedFiles);
        event.preventDefault();
        return;
      }

      if (items.length === 0 && event.clipboardData.files.length > 0) {
        const files = Array.from(event.clipboardData.files);
        if (files.length > 0) {
          handleImageFiles(files);
          event.preventDefault();
        }
      }
    },
    [handleImageFiles],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    maxSize: MAX_ATTACHMENT_SIZE_BYTES,
    maxFiles: MAX_ATTACHMENTS,
    onDrop: handleImageFiles,
    noClick: true,
    noKeyboard: true,
  });

  const handleSubmit = useCallback(
    async (
      event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>,
    ) => {
      event.preventDefault();
      const currentInput = inputValueRef.current;
      const hasAttachments = attachedImages.length > 0;
      if ((!currentInput.trim() && !hasAttachments) || isLoading || submitInFlightRef.current || !selectedProject) {
        return;
      }
      if (!isChatConnected) {
        addMessage({
          type: 'error',
          content: '聊天连接正在重连，请稍后再试。',
          timestamp: new Date(),
        }, selectedSession?.id || currentSessionId || null);
        return;
      }
      submitInFlightRef.current = true;

      // Intercept slash commands: if input starts with /commandName, execute as command with args.
      // Skip when handleCustomCommand just pushed a passthrough back into the
      // input box — we already executed it once and want this submit to flow
      // through as a normal user message.
      const trimmedInput = currentInput.trim();
      if (skipSlashDetectionOnceRef.current) {
        skipSlashDetectionOnceRef.current = false;
      } else if (trimmedInput.startsWith('/')) {
        const firstSpace = trimmedInput.indexOf(' ');
        const commandName = firstSpace > 0 ? trimmedInput.slice(0, firstSpace) : trimmedInput;
        const matchedCommand = slashCommands.find((cmd: SlashCommand) => cmd.name === commandName);
        if (matchedCommand) {
          executeCommand(matchedCommand, trimmedInput);
          submitInFlightRef.current = false;
          setInput('');
          inputValueRef.current = '';
          setAttachedImages([]);
          setUploadingImages(new Map());
          setImageErrors(new Map());
          resetCommandMenuState();
          setIsTextareaExpanded(false);
          pendingHomeAutoSubmitRef.current = null;
          setPendingHomeAutoSubmit(null);
          homePromptDraftGuardRef.current = null;
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
          }
          return;
        }
      }

      const userVisibleInput = currentInput.trim() || '请查看附件。';
      let messageContent = userVisibleInput;
      const selectedThinkingMode = thinkingModes.find((mode: { id: string; prefix?: string }) => mode.id === thinkingMode);
      if (selectedThinkingMode && selectedThinkingMode.prefix) {
        messageContent = `${selectedThinkingMode.prefix}: ${userVisibleInput}`;
      }

      // Pin the target session before any await so attachment upload cannot
      // race with a sidebar session switch and leak the optimistic bubble.
      const pendingSessionIdAtSubmit = pendingViewSessionRef.current?.sessionId ?? null;
      const canResumeCurrentSession =
        Boolean(currentSessionId) &&
        (Boolean(selectedSession?.id) || pendingSessionIdAtSubmit === currentSessionId);
      const submitTargetSessionId =
        selectedSession?.id ||
        (canResumeCurrentSession ? currentSessionId : null);
      const submitSelectedSession = selectedSession;

      // Optimistic sidebar refresh — fire BEFORE the attachment upload so
      // the sidebar reorders/spawns the row the instant the user clicks
      // send, not after the network round-trip. We resolve a stable
      // session id here (real id when resuming; otherwise a temporary
      // `new-session-*` placeholder that will be replaced by
      // `preserveLoadedSessions` once the server's `projects_updated`
      // arrives with the real id).
      const optimisticSessionId =
        submitTargetSessionId || createTemporarySessionId();
      if (selectedProject?.name) {
        onSessionActivityBump?.(
          selectedProject.name,
          optimisticSessionId,
          userVisibleInput,
        );
      }

      let uploadedImages: unknown[] = [];
      let uploadedFiles: UploadedAttachmentFile[] = [];
      if (attachedImages.length > 0) {
        const formData = new FormData();
        attachedImages.forEach((file) => {
          formData.append('attachments', file);
        });

        try {
          const response = await authenticatedFetch(`/api/projects/${encodeURIComponent(selectedProject.name)}/upload-attachments`, {
            method: 'POST',
            headers: {},
            body: formData,
          });

          if (!response.ok) {
            throw new Error('上传附件失败');
          }

          const result = await response.json();
          uploadedImages = Array.isArray(result.images) ? result.images : [];
          uploadedFiles = Array.isArray(result.files) ? result.files : [];
        } catch (error) {
          const message = error instanceof Error ? error.message : '未知错误';
          console.error('Attachment upload failed:', error);
          addMessage({
            type: 'error',
            content: `Failed to upload attachments: ${message}`,
            timestamp: new Date(),
          }, submitTargetSessionId);
          submitInFlightRef.current = false;
          return;
        }
      }

      messageContent = `${messageContent}${buildAttachmentPathNote(uploadedFiles)}`;

      const effectiveSessionId = submitTargetSessionId;
      const sessionToActivate = effectiveSessionId || optimisticSessionId;

      const userMessage: ChatMessage = {
        type: 'user',
        content: userVisibleInput,
        images: uploadedImages as any,
        attachments: uploadedFiles as any,
        timestamp: new Date(),
      };

      addMessage(userMessage, submitTargetSessionId);
      setIsLoading(true); // Start the processing banner.
      setCanAbortSession(true);
      setClaudeStatus({
        text: '处理中',
        tokens: 0,
        can_interrupt: true,
      });

      setIsUserScrolledUp(false);
      setTimeout(() => scrollToBottom(), 100);

      if (!effectiveSessionId && !submitSelectedSession?.id) {
        if (typeof window !== 'undefined') {
          // Reset stale pending IDs from previous interrupted runs before creating a new one.
          sessionStorage.removeItem('pendingSessionId');
        }
        pendingViewSessionRef.current = { sessionId: null, startedAt: Date.now() };
      }
      onSessionActive?.(sessionToActivate);
      if (effectiveSessionId && !isTemporarySessionId(effectiveSessionId)) {
        onSessionProcessing?.(effectiveSessionId);
      }

      // PilotDeck-only: a single localStorage entry (`pilotdeck-settings`)
      // tracks tool consent + skip-permissions for every chat. The legacy
      // per-provider keys (`cursor-tools-settings`, `codex-settings`,
      // `gemini-settings`) are no longer read or written.
      const getToolsSettings = () => {
        try {
          const savedSettings = safeLocalStorage.getItem('pilotdeck-settings');
          if (savedSettings) {
            return JSON.parse(savedSettings);
          }
        } catch (error) {
          console.error('Error loading tools settings:', error);
        }

        return {
          allowedTools: [],
          disallowedTools: [],
          skipPermissions: false,
        };
      };

      const toolsSettings = getToolsSettings();
      const sessionSummary = getNotificationSessionSummary(submitSelectedSession, userVisibleInput);

      try {
        startSessionCommand({
          sendMessage,
          selectedProject,
          command: messageContent,
          sessionId: effectiveSessionId,
          temporarySessionId: sessionToActivate,
          toolsSettings,
          permissionMode,
          model,
          sessionSummary,
          images: uploadedImages,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        addMessage({
          type: 'error',
          content: errorMessage,
          timestamp: new Date(),
        }, submitTargetSessionId);
        setIsLoading(false);
        setCanAbortSession(false);
        setClaudeStatus(null);
        setPilotDeckStatus(null);
        onSessionInactive?.(sessionToActivate);
        submitInFlightRef.current = false;
        return;
      }

      setInput('');
      inputValueRef.current = '';
      pendingHomeAutoSubmitRef.current = null;
      setPendingHomeAutoSubmit(null);
      homePromptDraftGuardRef.current = null;
      resetCommandMenuState();
      setAttachedImages([]);
      setUploadingImages(new Map());
      setImageErrors(new Map());
      setIsTextareaExpanded(false);
      setThinkingMode('none');

      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

      safeLocalStorage.removeItem(`draft_input_${selectedProject.name}`);
      window.setTimeout(() => {
        submitInFlightRef.current = false;
      }, 0);
    },
    [
      selectedSession,
      attachedImages,
      model,
      currentSessionId,
      executeCommand,
      isChatConnected,
      isLoading,
      onSessionActive,
      onSessionActivityBump,
      onSessionProcessing,
      pendingViewSessionRef,
      permissionMode,
      resetCommandMenuState,
      scrollToBottom,
      selectedProject,
      sendMessage,
      setCanAbortSession,
      addMessage,
      setClaudeStatus,
      setPilotDeckStatus,
      setIsLoading,
      setIsUserScrolledUp,
      slashCommands,
      thinkingMode,
    ],
  );

  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  useEffect(() => {
    inputValueRef.current = input;
  }, [input]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }
    const pendingHomePrompt =
      typeof window !== 'undefined'
        ? window.sessionStorage.getItem(HOME_PROMPT_STORAGE_KEY)
        : null;
    const guardedHomePrompt = homePromptDraftGuardRef.current;
    if (
      pendingHomePrompt ||
      (guardedHomePrompt && guardedHomePrompt.projectName === selectedProject.name)
    ) {
      return;
    }
    const savedInput = safeLocalStorage.getItem(`draft_input_${selectedProject.name}`) || '';
    setInput((previous) => {
      const next = previous === savedInput ? previous : savedInput;
      inputValueRef.current = next;
      return next;
    });
  }, [selectedProject]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }
    if (input !== '') {
      safeLocalStorage.setItem(`draft_input_${selectedProject.name}`, input);
    } else {
      safeLocalStorage.removeItem(`draft_input_${selectedProject.name}`);
    }
  }, [input, selectedProject]);

  useEffect(() => {
    if (!textareaRef.current) {
      return;
    }
    // Re-run when input changes so restored drafts get the same autosize behavior as typed text.
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight);
    const expanded = textareaRef.current.scrollHeight > lineHeight * 2;
    setIsTextareaExpanded(expanded);
  }, [input]);

  useEffect(() => {
    if (!textareaRef.current || input.trim()) {
      return;
    }
    textareaRef.current.style.height = 'auto';
    setIsTextareaExpanded(false);
  }, [input]);

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = event.target.value;
      const cursorPos = event.target.selectionStart;

      setInput(newValue);
      inputValueRef.current = newValue;
      setCursorPosition(cursorPos);

      if (!newValue.trim()) {
        event.target.style.height = 'auto';
        setIsTextareaExpanded(false);
        resetCommandMenuState();
        return;
      }

      handleCommandInputChange();
    },
    [handleCommandInputChange, resetCommandMenuState, setCursorPosition],
  );

  const applyIncomingPrompt = useCallback(
    (prompt: string, options: { autoSubmit?: boolean } = {}) => {
      const normalized = prompt.replace(/\s+/g, ' ').trim();
      if (!normalized) return;
      setInput(normalized);
      inputValueRef.current = normalized;
      homePromptDraftGuardRef.current = {
        projectName: selectedProject?.name ?? null,
        prompt: normalized,
      };
      resetCommandMenuState();
      requestAnimationFrame(() => {
        const node = textareaRef.current;
        if (!node) return;
        node.focus();
        node.setSelectionRange(normalized.length, normalized.length);
        node.style.height = 'auto';
        node.style.height = `${node.scrollHeight}px`;
      });
      if (options.autoSubmit) {
        pendingHomeAutoSubmitRef.current = normalized;
        setPendingHomeAutoSubmit(normalized);
      }
    },
    [resetCommandMenuState, selectedProject?.name],
  );

  useEffect(() => {
    if (!selectedProject || typeof window === 'undefined') return undefined;

    const consumeStoredPrompt = () => {
      const stored = window.sessionStorage.getItem(HOME_PROMPT_STORAGE_KEY);
      if (!stored) return;
      const autoSubmitPrompt = window.sessionStorage.getItem(HOME_PROMPT_AUTOSUBMIT_STORAGE_KEY);
      const autoSubmit = autoSubmitPrompt === '1' || autoSubmitPrompt === stored;
      window.sessionStorage.removeItem(HOME_PROMPT_STORAGE_KEY);
      applyIncomingPrompt(stored, { autoSubmit });
    };

    consumeStoredPrompt();

    const handleHomePrompt = (event: Event) => {
      const detail = (event as CustomEvent<{ prompt?: unknown; autoSubmit?: unknown }>).detail;
      if (typeof detail?.prompt === 'string') {
        const stored = window.sessionStorage.getItem(HOME_PROMPT_STORAGE_KEY);
        if (!stored || stored !== detail.prompt) return;
        const autoSubmitPrompt = window.sessionStorage.getItem(HOME_PROMPT_AUTOSUBMIT_STORAGE_KEY);
        const autoSubmit = detail.autoSubmit === true
          || autoSubmitPrompt === '1'
          || autoSubmitPrompt === detail.prompt;
        window.sessionStorage.removeItem(HOME_PROMPT_STORAGE_KEY);
        applyIncomingPrompt(detail.prompt, { autoSubmit });
      }
    };

    window.addEventListener('pilotdeck-home-prompt', handleHomePrompt);
    return () => {
      window.removeEventListener('pilotdeck-home-prompt', handleHomePrompt);
    };
  }, [applyIncomingPrompt, selectedProject]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const storedAutoSubmitPrompt = window.sessionStorage.getItem(HOME_PROMPT_AUTOSUBMIT_STORAGE_KEY);
    if (!storedAutoSubmitPrompt || pendingHomeAutoSubmitRef.current || pendingHomeAutoSubmit) {
      return;
    }
    if (input.trim() !== storedAutoSubmitPrompt) {
      return;
    }
    pendingHomeAutoSubmitRef.current = storedAutoSubmitPrompt;
    setPendingHomeAutoSubmit(storedAutoSubmitPrompt);
  }, [input, pendingHomeAutoSubmit]);

  useEffect(() => {
    const storedAutoSubmitPrompt =
      typeof window !== 'undefined'
        ? window.sessionStorage.getItem(HOME_PROMPT_AUTOSUBMIT_STORAGE_KEY)
        : null;
    const pendingPrompt = pendingHomeAutoSubmit || pendingHomeAutoSubmitRef.current || storedAutoSubmitPrompt;
    if (
      !pendingPrompt ||
      !selectedProject ||
      isLoading ||
      submitInFlightRef.current ||
      !isChatConnected ||
      !handleSubmitRef.current
    ) {
      return;
    }
    if (input.trim() !== pendingPrompt || inputValueRef.current.trim() !== pendingPrompt) {
      return;
    }

    pendingHomeAutoSubmitRef.current = null;
    setPendingHomeAutoSubmit(null);
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(HOME_PROMPT_AUTOSUBMIT_STORAGE_KEY);
    }
    void handleSubmitRef.current(createFakeSubmitEvent());
  }, [input, isChatConnected, isLoading, pendingHomeAutoSubmit, selectedProject]);

  const insertAtCursor = useCallback(
    (char: string) => {
      const textarea = textareaRef.current;
      const current = inputValueRef.current ?? input;
      const selectionStart = textarea?.selectionStart ?? current.length;
      const selectionEnd = textarea?.selectionEnd ?? selectionStart;
      const nextValue = `${current.slice(0, selectionStart)}${char}${current.slice(selectionEnd)}`;
      const nextCursor = selectionStart + char.length;

      setInput(nextValue);
      inputValueRef.current = nextValue;
      setCursorPosition(nextCursor);

      if (char === '/') {
        handleCommandInputChange();
      }

      requestAnimationFrame(() => {
        const node = textareaRef.current;
        if (!node) return;
        if (!node.matches(':focus')) {
          node.focus();
        }
        try {
          node.setSelectionRange(nextCursor, nextCursor);
        } catch {
          // ignore: textarea may have been unmounted between frames
        }
      });
    },
    [handleCommandInputChange, input, setCursorPosition, setInput, textareaRef],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (isImeEnterEvent(event)) {
        return;
      }

      if (handleCommandMenuKeyDown(event)) {
        return;
      }

      if (handleFileMentionsKeyDown(event)) {
        return;
      }

      if (shouldCycleRunModeOnKeyDown(event, { showFileDropdown, showCommandMenu })) {
        event.preventDefault();
        cycleRunMode();
        return;
      }

      if (event.key === 'Enter') {
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
          event.preventDefault();
          handleSubmit(event);
        } else if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !sendByCtrlEnter) {
          event.preventDefault();
          handleSubmit(event);
        }
      }
    },
    [
      cycleRunMode,
      handleCommandMenuKeyDown,
      handleFileMentionsKeyDown,
      handleSubmit,
      sendByCtrlEnter,
      showCommandMenu,
      showFileDropdown,
    ],
  );

  const handleTextareaClick = useCallback(
    (event: MouseEvent<HTMLTextAreaElement>) => {
      setCursorPosition(event.currentTarget.selectionStart);
    },
    [setCursorPosition],
  );

  const handleTextareaInput = useCallback(
    (event: FormEvent<HTMLTextAreaElement>) => {
      const target = event.currentTarget;
      target.style.height = 'auto';
      target.style.height = `${target.scrollHeight}px`;
      setCursorPosition(target.selectionStart);
      syncInputOverlayScroll(target);

      const lineHeight = parseInt(window.getComputedStyle(target).lineHeight);
      setIsTextareaExpanded(target.scrollHeight > lineHeight * 2);
    },
    [setCursorPosition, syncInputOverlayScroll],
  );

  const handleClearInput = useCallback(() => {
    setInput('');
    inputValueRef.current = '';
    resetCommandMenuState();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
    setIsTextareaExpanded(false);
  }, [resetCommandMenuState]);

  const handleAbortSession = useCallback(() => {
    if (!canAbortSession) {
      return;
    }

    const pendingSessionId =
      typeof window !== 'undefined' ? sessionStorage.getItem('pendingSessionId') : null;

    const candidateSessionIds = [
      currentSessionId,
      pendingViewSessionRef.current?.sessionId || null,
      pendingSessionId,
      selectedSession?.id || null,
    ];

    const targetSessionId =
      candidateSessionIds.find((sessionId) => Boolean(sessionId) && !isTemporarySessionId(sessionId)) || null;

    if (!targetSessionId) {
      console.warn('已请求中止，但还没有可用的具体会话 ID。');
      return;
    }

    sendMessage({
      type: 'abort-session',
      sessionId: targetSessionId,
      provider: 'pilotdeck',
    });

    setCanAbortSession(false);
    setIsAborting(true);
    setPilotDeckStatus({
      text: '正在停止',
      tokens: 0,
      can_interrupt: false,
    });
  }, [canAbortSession, currentSessionId, pendingViewSessionRef, selectedSession?.id, sendMessage, setCanAbortSession, setClaudeStatus, setIsAborting, setPilotDeckStatus]);

  const handleGrantToolPermission = useCallback(
    (suggestion: { entry: string; toolName: string }) => {
      if (!suggestion) {
        return { success: false };
      }
      // adapter. After the PolitDeck-only migration every provider
      // routes through the same gateway PermissionContext, so we let
      // every provider persist its grants to localStorage and have the
      // pilotdeck server pick them up via the gateway PermissionRuntime
      // on the next turn.
      return grantPilotDeckToolPermission(suggestion.entry);
    },
    [],
  );

  const handleGrantSessionToolPermission = useCallback(
    (suggestion: { entry: string; toolName: string }) => {
      if (!suggestion?.entry) {
        return { success: false };
      }

      const sessionId = [
        selectedSession?.id,
        currentSessionId,
        pendingViewSessionRef.current?.sessionId,
      ].find((candidate) => candidate && !isTemporarySessionId(candidate));

      if (!sessionId) {
        return { success: false };
      }

      sendMessage({
        type: 'session-permission-grant',
        sessionId,
        entry: suggestion.entry,
        toolName: suggestion.toolName,
      });
      return { success: true };
    },
    [currentSessionId, pendingViewSessionRef, selectedSession?.id, sendMessage],
  );

  const handlePermissionDecision = useCallback(
    (
      requestIds: string | string[],
      decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
    ) => {
      const ids = Array.isArray(requestIds) ? requestIds : [requestIds];
      const validIds = ids.filter(Boolean);
      if (validIds.length === 0) {
        return;
      }

      validIds.forEach((requestId) => {
        const pending = pendingPermissionRequests.find((r) => r.requestId === requestId);
        if (pending?.isElicitation) {
          // Elicitation flow (e.g. `ask_user_question`): submit selections
          // through GatewayElicitationBus, not GatewayPermissionBus.
          const submitted =
            (decision?.updatedInput as {
              answers?: Record<string, string | string[]>;
              annotations?: Record<string, { preview?: string; notes?: string }>;
            } | undefined) ?? {};
          const submittedAnswers = submitted.answers ?? {};
          const hasAnswers = Object.keys(submittedAnswers).length > 0;
          const answer =
            decision?.allow && hasAnswers
              ? {
                  type: 'answered' as const,
                  answers: submittedAnswers,
                  ...(submitted.annotations ? { annotations: submitted.annotations } : {}),
                }
              : {
                  type: 'cancelled' as const,
                  reason: decision?.message ?? (decision?.allow ? 'skipped' : 'declined'),
                };
          sendMessage({
            type: 'elicitation-response',
            requestId,
            answer,
          });
          return;
        }

        sendMessage({
          type: 'pilotdeck-permission-response',
          requestId,
          allow: Boolean(decision?.allow),
          updatedInput: decision?.updatedInput,
          message: decision?.message,
          rememberEntry: decision?.rememberEntry,
        });
      });

      setPendingPermissionRequests((previous) => {
        const next = previous.filter((request) => !validIds.includes(request.requestId));
        if (next.length === 0) {
          setClaudeStatus(null);
          setPilotDeckStatus(null);
        }
        return next;
      });
    },
    [pendingPermissionRequests, sendMessage, setClaudeStatus, setPilotDeckStatus, setPendingPermissionRequests],
  );

  const [isInputFocused, setIsInputFocused] = useState(false);

  const handleInputFocusChange = useCallback(
    (focused: boolean) => {
      setIsInputFocused(focused);
      onInputFocusChange?.(focused);
    },
    [onInputFocusChange],
  );

  return {
    input,
    setInput,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    thinkingMode,
    setThinkingMode,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    dismissCommandMenu,
    handleCommandSelect,
    handleToggleCommandMenu,
    showFileDropdown,
    filteredFiles: filteredFiles as MentionableFile[],
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    attachedImages,
    setAttachedImages,
    uploadingImages,
    imageErrors,
    getRootProps,
    getInputProps,
    isDragActive,
    openImagePicker: open,
    handleSubmit,
    handleInputChange,
    insertAtCursor,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleClearInput,
    handleAbortSession,
    handlePermissionDecision,
    handleGrantToolPermission,
    handleGrantSessionToolPermission,
    handleInputFocusChange,
    isInputFocused,
  };
}
