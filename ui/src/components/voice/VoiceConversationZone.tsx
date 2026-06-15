import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Mic, MicOff, PhoneOff, Sparkles, X } from 'lucide-react';
import { useVoiceAssistant } from '../../contexts/VoiceAssistantContext';

/**
 * Voice UI occupying the TOP of the right sidebar (SystemStatusPanel).
 * - Collapsed: a big mic button filling the voice area (replaces the old
 *   floating FAB). Clicking it opens the conversation and starts a call.
 * - Expanded: the full conversation (target selector, transcript, controls).
 * Renders nothing when the sidecar is not configured.
 */
export default function VoiceConversationZone() {
  const { t } = useTranslation();
  const {
    enabled, panelOpen, active, connecting, muted, error, conv, targetProject, projects,
    settings, wakeListening,
    openPanel, closePanel, start, stop, toggleMute, setTargetProject,
  } = useVoiceAssistant();

  const statusLabel = useMemo(() => {
    if (connecting) return t('voice.status.connecting', { defaultValue: '连接中…' });
    if (!active) return t('voice.status.idleOff', { defaultValue: '未开始' });
    switch (conv?.streamState) {
      case 'listening': return t('voice.status.listening', { defaultValue: '聆听中…' });
      case 'processing': return t('voice.status.processing', { defaultValue: '思考中…' });
      case 'speaking': return t('voice.status.speaking', { defaultValue: '说话中…' });
      default: return t('voice.status.ready', { defaultValue: '已就绪，请开始说话' });
    }
  }, [connecting, active, conv?.streamState, t]);

  const delegating =
    active && conv?.streamState === 'processing' && conv?.tool_call?.name === 'delegate_to_opcbrain';

  if (enabled === false) return null;

  // ── Collapsed: big button fills the voice area ──────────────────────────
  if (!panelOpen) {
    const handleOpen = () => {
      openPanel();
      if (!active && !connecting) void start();
    };
    const pulse = active
      ? conv?.streamState === 'speaking'
        ? 'ring-emerald-400/60'
        : conv?.streamState === 'processing'
          ? 'ring-amber-400/60'
          : 'ring-indigo-400/60'
      : '';
    return (
      <button
        type="button"
        onClick={handleOpen}
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 border-b border-surface-200 p-6 text-center transition hover:bg-surface-50 dark:border-surface-800 dark:hover:bg-surface-800/40"
      >
        <span
          className={`inline-flex h-20 w-20 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg ${active ? `ring-8 ${pulse} animate-pulse` : ''}`}
        >
          <Mic className="h-9 w-9" strokeWidth={1.9} />
        </span>
        <span className="text-sm font-medium text-surface-800 dark:text-surface-100">
          {active
            ? statusLabel
            : t('voice.start', { defaultValue: '开始语音对话' })}
        </span>
        {active && targetProject ? (
          <span className="rounded-full bg-surface-100 px-2 py-0.5 text-[11px] text-surface-500 dark:bg-surface-800 dark:text-surface-400">
            📁 {targetProject.displayName || targetProject.name}
          </span>
        ) : !active && wakeListening ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />
            {t('voice.wakeListening', { defaultValue: '聆听唤醒词' })}「{settings.wakeWord}」
          </span>
        ) : (
          <span className="text-xs text-surface-400">
            {t('voice.title', { defaultValue: '语音助理' })}
          </span>
        )}
      </button>
    );
  }

  // ── Expanded: full conversation ─────────────────────────────────────────
  const targetValue = targetProject?.name ?? '';
  return (
    <div className="flex min-h-0 flex-1 flex-col border-b border-surface-200 dark:border-surface-800">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Mic className="h-4 w-4 shrink-0 text-indigo-500" />
          <span className="truncate text-sm font-medium text-surface-800 dark:text-surface-100">
            {t('voice.title', { defaultValue: '语音助理' })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-surface-500 dark:text-surface-400">{statusLabel}</span>
          <button
            type="button"
            onClick={closePanel}
            className="rounded p-0.5 text-surface-400 hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-surface-800"
            title={t('voice.minimize', { defaultValue: '收起' }) as string}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Target selector */}
      <div className="px-3 pb-2">
        <select
          value={targetValue}
          onChange={(e) => {
            const name = e.target.value;
            setTargetProject(name ? projects.find((p) => p.name === name) ?? null : null);
          }}
          className="w-full rounded-md border border-surface-200 bg-surface-50 px-2 py-1 text-xs text-surface-700 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-200"
        >
          <option value="">🌐 {t('voice.globalTarget', { defaultValue: '全局助理' })}</option>
          {projects.map((p) => (
            <option key={p.name} value={p.name}>📁 {p.displayName || p.name}</option>
          ))}
        </select>
      </div>

      {/* Transcript (scrolls) */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {!conv?.messages?.length ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-2 text-center text-xs text-surface-400">
            <Sparkles className="h-5 w-5" />
            <p>{t('voice.hint', { defaultValue: '点击下方按钮或说出唤醒词开始语音对话。需要动手做的事会交给 OPCBrain 执行并讲给你听。' })}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {conv.messages.map((m, i) => (
              <div
                key={`${i}-${m.turnId ?? ''}`}
                className={
                  m.role === 'user'
                    ? 'self-end rounded-2xl rounded-br-sm bg-indigo-500 px-3 py-1.5 text-xs text-white'
                    : m.role === 'assistant'
                      ? 'self-start rounded-2xl rounded-bl-sm bg-surface-100 px-3 py-1.5 text-xs text-surface-800 dark:bg-surface-800 dark:text-surface-100'
                      : 'self-center rounded-full bg-surface-100 px-2 py-0.5 text-[10px] text-surface-500 dark:bg-surface-800 dark:text-surface-400'
                }
              >
                {m.content}
              </div>
            ))}
            {delegating && (
              <div className="flex items-center gap-1.5 self-start rounded-2xl rounded-bl-sm border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11px] text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-300">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t('voice.delegating', { defaultValue: '正在让 OPCBrain 处理…' })}
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mx-3 mb-2 rounded-md bg-red-50 px-2 py-1.5 text-[11px] text-red-600 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-center gap-3 px-3 py-2.5">
        {!active ? (
          <button
            type="button"
            onClick={() => void start()}
            disabled={connecting}
            className="inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5" />}
            {connecting ? t('voice.connecting', { defaultValue: '连接中…' }) : t('voice.start', { defaultValue: '开始语音对话' })}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={toggleMute}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-surface-300 text-surface-700 transition hover:bg-surface-100 dark:border-surface-700 dark:text-surface-200 dark:hover:bg-surface-800"
              title={(muted ? t('voice.unmute', { defaultValue: '取消静音' }) : t('voice.mute', { defaultValue: '静音' })) as string}
            >
              {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => void stop()}
              className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-red-500"
            >
              <PhoneOff className="h-3.5 w-3.5" />
              {t('voice.stop', { defaultValue: '结束对话' })}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
