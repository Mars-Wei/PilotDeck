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
  /** Minimum pinyin similarity (0–1) for the heard speech to trigger the wake. */
  wakeThreshold: number;
  dismissWord: string;
  idleTimeoutMs: number;
  goodbyeLine: string;
  welcomeLine: string;
  fanOutThreshold: number;
};

const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  wakeEnabled: false,
  wakeWord: '小智秘书',
  wakeThreshold: 0.5,
  dismissWord: '退下吧',
  idleTimeoutMs: 60_000,
  goodbyeLine: '我先退下了',
  welcomeLine: '你好，我是小智秘书，需要我帮你做什么？',
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

// Exit-intent detection (frontend, reliable). The talker LLM does NOT reliably
// call a tool to end the call, but DashScope ASR transcribes accurately, so we
// match the user's speech against exit phrases. STRONG phrases match anywhere;
// AMBIGUOUS ones only match in a short utterance (so "就这样做这件事" — a long
// instruction — doesn't end the call, while "就这样吧" does).
const STRONG_EXIT_PHRASES = [
  '退下吧', '退下', '我先退下', '拜拜', '再见', '回头见', '回见', '告辞',
  '结束对话', '不打扰了', '下次再聊', '不聊了',
];
const AMBIGUOUS_EXIT_PHRASES = [
  '没事了', '没别的事', '不用了', '就这样', '就到这', '就到此', '好了谢谢',
  '先这样', '我挂了', '挂了', '结束吧',
];
function matchesExitIntent(text: string): boolean {
  const t = normalizePhrase(text);
  if (!t) return false;
  if (STRONG_EXIT_PHRASES.some((p) => t.includes(normalizePhrase(p)))) return true;
  if (t.length <= 10 && AMBIGUOUS_EXIT_PHRASES.some((p) => t.includes(normalizePhrase(p)))) return true;
  return false;
}

// ── Pinyin fuzzy matching for the wake word ──────────────────────────────
// Browser zh-CN recognition mis-hears proper-noun wake words (e.g. 「小智秘书」
// often comes back as 「小日蜜蜂」). Comparing pinyin syllables with a similarity
// threshold tolerates these near-misses (秘→蜜 are identical in pinyin; 智→日,
// 书→蜂 are close), without the brittleness of exact-text matching.

let _pinyinFn: ((text: string) => string[]) | null = null;
let _pinyinLoading: Promise<void> | null = null;

/** Lazy-load pinyin-pro (own chunk; only when the wake word is enabled). */
function ensurePinyin(): Promise<void> {
  if (_pinyinFn) return Promise.resolve();
  if (!_pinyinLoading) {
    _pinyinLoading = import('pinyin-pro')
      .then((mod: any) => {
        const fn = mod?.pinyin ?? mod?.default?.pinyin;
        _pinyinFn = (text: string) => {
          try {
            return (fn(text, { toneType: 'none', type: 'array' }) as string[])
              .map((s) => s.toLowerCase().replace(/[^a-z]/g, ''))
              .filter(Boolean);
          } catch {
            return [];
          }
        };
      })
      .catch(() => { _pinyinFn = null; _pinyinLoading = null; });
  }
  return _pinyinLoading;
}

function toPinyinSyllables(text: string): string[] {
  return _pinyinFn ? _pinyinFn(text) : [];
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Per-syllable similarity in [0,1] (1 = identical pinyin). */
function syllableSim(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  return Math.max(0, 1 - levenshtein(a, b) / maxLen);
}

/**
 * Best-window pinyin similarity of `wake` syllables against `heard` syllables.
 * Slides a window of the wake length over the heard utterance so extra words
 * around the wake phrase don't dilute the score.
 */
function pinyinMatchScore(heard: string[], wake: string[]): number {
  if (wake.length === 0 || heard.length === 0) return 0;
  if (heard.length < wake.length) {
    // Compare what we have, normalized by the full wake length.
    let s = 0;
    for (let i = 0; i < heard.length; i += 1) s += syllableSim(heard[i], wake[i]);
    return s / wake.length;
  }
  let best = 0;
  for (let start = 0; start + wake.length <= heard.length; start += 1) {
    let s = 0;
    for (let i = 0; i < wake.length; i += 1) s += syllableSim(heard[start + i], wake[i]);
    best = Math.max(best, s / wake.length);
  }
  return best;
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
    if (!normalizePhrase(settingsRef.current.wakeWord)) return;
    void ensurePinyin();
    let rec: any;
    try { rec = new SR(); } catch { return; }
    rec.lang = 'zh-CN';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onstart = () => { console.info('[voice-wake] start (listening for)', settingsRef.current.wakeWord); };
    rec.onresult = (e: any) => {
      const wakeWord = settingsRef.current.wakeWord;
      const threshold = settingsRef.current.wakeThreshold || 0.5;
      const wakeSyll = toPinyinSyllables(wakeWord);
      for (let i = e.resultIndex ?? 0; i < e.results.length; i += 1) {
        const raw = e.results[i]?.[0]?.transcript || '';
        let hit = false;
        let score = 0;
        if (wakeSyll.length > 0) {
          score = pinyinMatchScore(toPinyinSyllables(raw), wakeSyll);
          hit = score >= threshold;
        } else {
          // pinyin not loaded yet → exact normalized substring fallback
          const t = normalizePhrase(raw);
          hit = Boolean(t) && t.includes(normalizePhrase(wakeWord));
        }
        console.info('[voice-wake] heard:', JSON.stringify(raw), 'pinyinScore=', score.toFixed(2), 'thr=', threshold, 'match=', hit);
        if (hit) {
          console.info('[voice-wake] WAKE matched → connecting');
          stopWake();
          openPanelRef.current();
          void startRef.current();
          return;
        }
      }
    };
    rec.onerror = (e: any) => {
      console.info('[voice-wake] error:', e?.error);
      // Permission/service denied → give up (don't busy-loop restart).
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
        wantWakeRef.current = false;
        setWakeListening(false);
      }
    };
    rec.onend = () => {
      console.info('[voice-wake] end (restart=', wantWakeRef.current, ')');
      setWakeListening(false);
      recognitionRef.current = null;
      // Chrome auto-stops on silence; restart while we still want to listen.
      if (wantWakeRef.current) {
        setTimeout(() => {
          if (wantWakeRef.current && !recognitionRef.current) startWake();
        }, 800);
      }
    };
    wantWakeRef.current = true;
    recognitionRef.current = rec;
    try {
      rec.start();
      setWakeListening(true);
      console.info('[voice-wake] recognizer.start() called');
    } catch (err) {
      console.info('[voice-wake] start() threw:', err);
      recognitionRef.current = null;
      wantWakeRef.current = false;
    }
  }, [stopWake]);

  // Run the recognizer only while idle + wake enabled (talker owns the mic
  // during an active call, so don't double-capture).
  useEffect(() => {
    const shouldRun = enabled && settings.wakeEnabled && !active && !connecting;
    console.info('[voice-wake] lifecycle: enabled=', enabled, 'wakeEnabled=', settings.wakeEnabled,
      'active=', active, 'connecting=', connecting, '→ run=', shouldRun);
    if (shouldRun) {
      startWake();
    } else {
      stopWake();
    }
    return () => { stopWake(); };
  }, [enabled, settings.wakeEnabled, active, connecting, startWake, stopWake]);

  // Exit intent: the talker LLM calls the `end_conversation` tool when the user
  // says they want to stop (退下吧/再见/拜拜/没事了/…). We detect it via the
  // conversation's tool_call state (same channel as delegate_to_opcbrain) and
  // hang up once the spoken goodbye finishes. Letting the LLM judge intent is
  // robust to phrasing AND — unlike scanning conv.messages for a keyword — is
  // not fooled by the history the SDK replays on reconnect (tool_call state is
  // not replayed). The talker voice speaks the goodbye, so no browser TTS here.
  // Ignore the conversation history the SDK replays on (re)connect so an old
  // exit phrase in it can't end the call instantly.
  const connectAtRef = useRef(0);
  useEffect(() => { connectAtRef.current = active ? Date.now() : 0; }, [active]);

  const endPendingRef = useRef(false);
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastExitIdxRef = useRef(0);
  const clearEndState = useCallback(() => {
    endPendingRef.current = false;
    if (endTimerRef.current) { clearTimeout(endTimerRef.current); endTimerRef.current = null; }
  }, []);
  const triggerEnd = useCallback((reason: string) => {
    if (endPendingRef.current) return;
    endPendingRef.current = true;
    console.info('[voice-end] ending —', reason);
    // Let the spoken goodbye (LLM reply or end_conversation tool) play, then hang up.
    endTimerRef.current = setTimeout(() => { clearEndState(); void stop(); }, 4500);
  }, [stop, clearEndState]);
  useEffect(() => {
    if (!active) { clearEndState(); lastExitIdxRef.current = 0; return; }
    // LLM tool path (bonus — only when the model actually calls it).
    if (conv?.tool_call?.name === 'end_conversation') { triggerEnd('end_conversation tool'); return; }
    // Primary path: match the user's transcribed speech against exit phrases.
    const msgs = conv?.messages ?? [];
    if (connectAtRef.current && Date.now() - connectAtRef.current < 2500) {
      lastExitIdxRef.current = msgs.length; // skip replayed history
      return;
    }
    for (let i = lastExitIdxRef.current; i < msgs.length; i += 1) {
      const m = msgs[i];
      if (m.role === 'user' && matchesExitIntent(m.content)) {
        lastExitIdxRef.current = msgs.length;
        triggerEnd(`phrase: ${m.content}`);
        return;
      }
    }
    lastExitIdxRef.current = msgs.length;
  }, [active, conv, triggerEnd, clearEndState]);

  // Pre-warm the browser cache for the heavy voice assets (ORT wasm + Silero
  // model + SDK) as soon as the page knows voice is enabled. The big download
  // then happens quietly in the background, so the first call connects fast
  // instead of stalling on a multi-MB download. Safe: no mic, no connection.
  useEffect(() => {
    if (enabled !== true) return;
    const assets = [
      '/talker/index.js',
      '/talker/vendor/onnxruntime-web/ort.wasm.min.js',
      '/talker/vendor/onnxruntime-web/ort-wasm-simd-threaded.mjs',
      '/talker/vendor/onnxruntime-web/ort-wasm-simd-threaded.wasm',
      '/talker/vendor/vad-web/bundle.min.js',
      '/talker/vendor/vad-web/silero_vad_v5.onnx',
    ];
    for (const url of assets) {
      fetch(url, { cache: 'force-cache' }).catch(() => { /* best-effort warm */ });
    }
  }, [enabled]);

  // Idle timeout: hang up after silence (but not mid-processing/speaking).
  const streamState = conv?.streamState;
  const msgCount = conv?.messages?.length ?? 0;
  useEffect(() => {
    if (!active) return undefined;
    const ms = settings.idleTimeoutMs;
    if (!ms || ms <= 0) return undefined;
    if (streamState === 'processing' || streamState === 'speaking') return undefined;
    console.info('[voice-idle] arming idle timer', ms, 'ms (streamState=', streamState, 'msgs=', msgCount, ')');
    const timer = setTimeout(() => {
      console.info('[voice-idle] idle timeout fired → hanging up');
      void dismiss(true);
    }, ms);
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
