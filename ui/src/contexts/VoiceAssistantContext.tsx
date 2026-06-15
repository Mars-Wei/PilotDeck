import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Project } from '../types/app';
import { AUTH_TOKEN_STORAGE_KEY } from '../components/auth/constants';

// ─────────────────────────────────────────────────────────────────────────
// talker SDK types (the bundle is loaded at runtime from /talker/index.js)
// ─────────────────────────────────────────────────────────────────────────
export type VoiceStreamState = 'idle' | 'listening' | 'processing' | 'speaking';
type VoiceConnectionState = 'connected' | 'reconnecting' | 'disconnected';

export type VoiceMessage = { role: 'user' | 'assistant' | 'info'; content: string; turnId?: number };

export type VoiceConversationState = {
  connectionState: VoiceConnectionState;
  streamState: VoiceStreamState;
  sessionId: string | null;
  messages: VoiceMessage[];
  tool_call: { name: string; args: Record<string, unknown> };
};

type VoiceSession = {
  open(): Promise<void>;
  close(): Promise<void>;
  onStateChange(cb: (state: VoiceConversationState) => void): void;
  muted: boolean;
};

type CreateSession = (
  websocketURL: string,
  config?: { serviceURLs?: Record<string, unknown> },
) => VoiceSession;

const SDK_URL = '/talker/index.js';

async function loadCreateSession(): Promise<CreateSession> {
  const mod: any = await import(/* @vite-ignore */ SDK_URL);
  const factory = mod?.createSession ?? mod?.default?.createSession;
  if (typeof factory !== 'function') {
    throw new Error('talker SDK: createSession not found');
  }
  return factory as CreateSession;
}

function buildVoiceWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/voice-ws`;
}

function projectPathOf(p: Project | null): string {
  return p?.fullPath || p?.path || '';
}

// ─────────────────────────────────────────────────────────────────────────
// Wake word / dismissal (Phase D)
// ─────────────────────────────────────────────────────────────────────────
export type VoiceSettings = {
  wakeEnabled: boolean;
  wakeWord: string;
  dismissWord: string;
  idleTimeoutMs: number;
  goodbyeLine: string;
  fanOutThreshold: number;
};

const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  wakeEnabled: false,
  wakeWord: '小智秘书',
  dismissWord: '退下吧',
  idleTimeoutMs: 60_000,
  goodbyeLine: '我先退下了',
  fanOutThreshold: 5,
};

/** Lowercase + strip whitespace/punctuation so spoken phrasing matches loosely. */
function normalizePhrase(s: string): string {
  try {
    return (s || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  } catch {
    return (s || '').toLowerCase().replace(/[\s.,!?；。，！？、·]+/g, '');
  }
}

function getSpeechRecognition(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

/** Speak a short line via the browser TTS (independent of the talker mic). */
function speakLine(line: string): void {
  if (!line || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(line);
    u.lang = 'zh-CN';
    window.speechSynthesis.speak(u);
  } catch {
    /* TTS unavailable — silent */
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────
type VoiceAssistantContextType = {
  enabled: boolean | null;
  panelOpen: boolean;
  active: boolean;
  connecting: boolean;
  muted: boolean;
  error: string | null;
  conv: VoiceConversationState | null;
  /** null = 🌐 global mode; otherwise the target project for "do work" requests. */
  targetProject: Project | null;
  projects: Project[];
  /** Voice assistant settings (wake word / dismissal / idle). */
  settings: VoiceSettings;
  /** True while the browser wake-word recognizer is actively listening. */
  wakeListening: boolean;
  openPanel: () => void;
  closePanel: () => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  toggleMute: () => void;
  setTargetProject: (project: Project | null) => void;
};

const VoiceAssistantContext = createContext<VoiceAssistantContextType | null>(null);

export function useVoiceAssistant(): VoiceAssistantContextType {
  const ctx = useContext(VoiceAssistantContext);
  if (!ctx) throw new Error('useVoiceAssistant must be used within a VoiceAssistantProvider');
  return ctx;
}

type ProviderProps = {
  children: ReactNode;
  projects: Project[];
  selectedProject: Project | null;
};

export function VoiceAssistantProvider({ children, projects, selectedProject }: ProviderProps) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [active, setActive] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conv, setConv] = useState<VoiceConversationState | null>(null);
  const [targetProject, setTargetProjectState] = useState<Project | null>(null);
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [wakeListening, setWakeListening] = useState(false);

  const sessionRef = useRef<VoiceSession | null>(null);
  // Keep the latest selectedProject readable inside callbacks without re-binding.
  const selectedRef = useRef<Project | null>(selectedProject);
  selectedRef.current = selectedProject;

  // Probe whether the voice sidecar is configured (once).
  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    fetch('/api/voice/status', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setEnabled(Boolean(d?.enabled)); })
      .catch(() => { if (!cancelled) setEnabled(false); });
    return () => { cancelled = true; };
  }, []);

  // Fetch wake/dismiss/idle settings (once).
  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    fetch('/api/voice/settings', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d || typeof d !== 'object') return;
        setSettings((prev) => ({ ...prev, ...d }));
      })
      .catch(() => { /* keep defaults */ });
    return () => { cancelled = true; };
  }, []);

  const stop = useCallback(async () => {
    const s = sessionRef.current;
    sessionRef.current = null;
    setActive(false);
    setConnecting(false);
    setConv(null);
    if (s) {
      try { await s.close(); } catch { /* ignore close errors */ }
    }
  }, []);

  // Tear down the session if the whole app unmounts.
  useEffect(() => () => { void stop(); }, [stop]);

  const startWithTarget = useCallback(async (target: Project | null) => {
    if (connecting) return;
    // Reconnect cleanly if a session is already live (Phase A: switching target
    // re-establishes the session; seamless mid-session switch comes later).
    if (sessionRef.current) {
      await stop();
    }
    setError(null);
    setConnecting(true);
    try {
      const createSession = await loadCreateSession();
      const projectPath = projectPathOf(target);
      const loginUrl = `/api/voice/login?projectPath=${encodeURIComponent(projectPath)}`;
      const session = createSession(buildVoiceWsUrl(), {
        serviceURLs: {
          login: loginUrl,
          sessions: '/api/voice/sessions',
          sessionDetail: (id: string) => `/api/voice/sessions/${id}`,
          upload: '/api/voice/upload',
        },
      });
      session.onStateChange((state) => setConv({ ...state }));
      sessionRef.current = session;
      await session.open();
      session.muted = false;
      setMuted(false);
      setActive(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await stop();
    } finally {
      setConnecting(false);
    }
  }, [connecting, stop]);

  const start = useCallback(async () => {
    await startWithTarget(targetProject);
  }, [startWithTarget, targetProject]);

  const openPanel = useCallback(() => {
    setPanelOpen(true);
    // Default target follows the currently open project when not already talking.
    if (!sessionRef.current) {
      setTargetProjectState(selectedRef.current ?? null);
    }
  }, []);

  const closePanel = useCallback(() => setPanelOpen(false), []);

  const setTargetProject = useCallback((project: Project | null) => {
    setTargetProjectState(project);
    // If a call is live, re-establish it against the new target.
    if (sessionRef.current) {
      void startWithTarget(project);
    }
  }, [startWithTarget]);

  const toggleMute = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const next = !muted;
    s.muted = next;
    setMuted(next);
  }, [muted]);

  // ── Phase D: wake word / dismissal / idle timeout ───────────────────────
  // Stable refs so the long-lived recognizer + timers read fresh values
  // without re-binding (which would tear the recognizer down every render).
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const startRef = useRef(start);
  startRef.current = start;
  const openPanelRef = useRef(openPanel);
  openPanelRef.current = openPanel;

  // Graceful dismissal: drop the call, then speak the goodbye line locally
  // (browser TTS, independent of the talker mic which is now released).
  const dismiss = useCallback(async (speakGoodbye: boolean) => {
    await stop();
    if (speakGoodbye) speakLine(settingsRef.current.goodbyeLine);
  }, [stop]);

  // Wake-word recognizer (browser SpeechRecognition — Chrome/Edge, cloud-backed).
  const recognitionRef = useRef<any>(null);
  const wantWakeRef = useRef(false);

  const stopWake = useCallback(() => {
    wantWakeRef.current = false;
    const r = recognitionRef.current;
    recognitionRef.current = null;
    setWakeListening(false);
    if (r) {
      try { r.onend = null; r.onerror = null; r.onresult = null; r.abort(); } catch { /* ignore */ }
    }
  }, []);

  const startWake = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR || recognitionRef.current) return;
    const word = normalizePhrase(settingsRef.current.wakeWord);
    if (!word) return;
    let rec: any;
    try { rec = new SR(); } catch { return; }
    rec.lang = 'zh-CN';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      for (let i = e.resultIndex ?? 0; i < e.results.length; i += 1) {
        const txt = normalizePhrase(e.results[i]?.[0]?.transcript || '');
        if (txt && txt.includes(word)) {
          stopWake();
          openPanelRef.current();
          void startRef.current();
          return;
        }
      }
    };
    rec.onerror = (e: any) => {
      // Permission/service denied → give up (don't busy-loop restart).
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
        wantWakeRef.current = false;
        setWakeListening(false);
      }
    };
    rec.onend = () => {
      setWakeListening(false);
      recognitionRef.current = null;
      // Chrome auto-stops on silence; restart while we still want to listen.
      if (wantWakeRef.current) {
        setTimeout(() => {
          if (wantWakeRef.current && !recognitionRef.current) startWake();
        }, 400);
      }
    };
    wantWakeRef.current = true;
    recognitionRef.current = rec;
    try {
      rec.start();
      setWakeListening(true);
    } catch {
      recognitionRef.current = null;
      wantWakeRef.current = false;
    }
  }, [stopWake]);

  // Run the recognizer only while idle + wake enabled (talker owns the mic
  // during an active call, so don't double-capture).
  useEffect(() => {
    if (enabled && settings.wakeEnabled && !active && !connecting) {
      startWake();
    } else {
      stopWake();
    }
    return () => { stopWake(); };
  }, [enabled, settings.wakeEnabled, active, connecting, startWake, stopWake]);

  // Dismiss word: end the call when the user says e.g. 「退下吧」.
  const lastDismissIdxRef = useRef(0);
  useEffect(() => {
    if (!active) { lastDismissIdxRef.current = 0; return; }
    const msgs = conv?.messages ?? [];
    const word = normalizePhrase(settingsRef.current.dismissWord);
    if (word) {
      for (let i = lastDismissIdxRef.current; i < msgs.length; i += 1) {
        const m = msgs[i];
        if (m.role === 'user' && normalizePhrase(m.content).includes(word)) {
          lastDismissIdxRef.current = msgs.length;
          void dismiss(true);
          return;
        }
      }
    }
    lastDismissIdxRef.current = msgs.length;
  }, [active, conv?.messages, dismiss]);

  // Idle timeout: hang up after silence (but not mid-processing/speaking).
  const streamState = conv?.streamState;
  const msgCount = conv?.messages?.length ?? 0;
  useEffect(() => {
    if (!active) return undefined;
    const ms = settings.idleTimeoutMs;
    if (!ms || ms <= 0) return undefined;
    if (streamState === 'processing' || streamState === 'speaking') return undefined;
    const timer = setTimeout(() => { void dismiss(true); }, ms);
    return () => clearTimeout(timer);
  }, [active, settings.idleTimeoutMs, streamState, msgCount, dismiss]);

  const value = useMemo<VoiceAssistantContextType>(() => ({
    enabled, panelOpen, active, connecting, muted, error, conv, targetProject, projects,
    settings, wakeListening,
    openPanel, closePanel, start, stop, toggleMute, setTargetProject,
  }), [enabled, panelOpen, active, connecting, muted, error, conv, targetProject, projects,
    settings, wakeListening,
    openPanel, closePanel, start, stop, toggleMute, setTargetProject]);

  return (
    <VoiceAssistantContext.Provider value={value}>{children}</VoiceAssistantContext.Provider>
  );
}
