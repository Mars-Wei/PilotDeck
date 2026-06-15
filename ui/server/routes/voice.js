import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { getProjects } from '../projects.js';
import { recordVoiceExchange } from '../services/voiceTranscript.js';
import { readPilotDeckConfigFile } from '../services/pilotdeckConfig.js';

const router = express.Router();

// Voice assistant runtime settings (wake word / dismissal / idle). Read from the
// `voice:` section of ~/.opcbrain/opcbrain.yaml, merged over these defaults.
// Wake word defaults OFF — it is the most experimental path (browser Speech
// recognition, Chrome-only, cloud-backed) so users opt in explicitly.
const DEFAULT_VOICE_SETTINGS = {
  wakeEnabled: false,
  wakeWord: '小智秘书',
  dismissWord: '退下吧',
  idleTimeoutMs: 60_000,
  goodbyeLine: '我先退下了',
  fanOutThreshold: 5,
};

function readVoiceSettings() {
  let raw = {};
  try {
    const file = readPilotDeckConfigFile();
    raw = file?.rawYaml?.voice ?? file?.config?.voice ?? {};
    if (typeof raw !== 'object' || raw === null) raw = {};
  } catch {
    raw = {};
  }
  const merged = { ...DEFAULT_VOICE_SETTINGS, ...raw };
  // Coerce/guard a few fields so the frontend never gets a bad value.
  merged.wakeEnabled = Boolean(merged.wakeEnabled);
  merged.wakeWord = String(merged.wakeWord || DEFAULT_VOICE_SETTINGS.wakeWord).trim();
  merged.dismissWord = String(merged.dismissWord || DEFAULT_VOICE_SETTINGS.dismissWord).trim();
  merged.goodbyeLine = String(merged.goodbyeLine || DEFAULT_VOICE_SETTINGS.goodbyeLine).trim();
  const idle = Number(merged.idleTimeoutMs);
  merged.idleTimeoutMs = Number.isFinite(idle) && idle > 0 ? idle : DEFAULT_VOICE_SETTINGS.idleTimeoutMs;
  const fan = Number(merged.fanOutThreshold);
  merged.fanOutThreshold = Number.isFinite(fan) && fan > 0 ? fan : DEFAULT_VOICE_SETTINGS.fanOutThreshold;
  return merged;
}

// Small TTL cache for the voice project list. The talker sidecar hits this on
// every "delegate to project X" turn (for fuzzy name resolution) and once per
// connection; getProjects() is relatively heavy, so cache briefly.
let _projectListCache = { at: 0, list: null };
const PROJECT_LIST_TTL_MS = 15_000;

async function loadVoiceProjectList() {
  const now = Date.now();
  if (_projectListCache.list && now - _projectListCache.at < PROJECT_LIST_TTL_MS) {
    return _projectListCache.list;
  }
  const projects = await getProjects();
  const list = (projects || [])
    .map((p) => ({
      name: p.name,
      displayName: p.displayName || p.name,
      fullPath: p.fullPath || p.path || '',
    }))
    .filter((p) => p.name && p.fullPath);
  _projectListCache = { at: now, list };
  return list;
}

// Shared HS256 secret with the talker voice sidecar. The sidecar decodes the
// token we mint here to read project_path / voice_session_id claims.
const TALKER_AUTH_SECRET = process.env.TALKER_AUTH_SECRET || '';
// Upstream talker WS, reachable inside the docker-compose network. Used by the
// /voice-ws proxy in index.js; re-exported so index.js can import it.
const TALKER_VOICE_URL = process.env.TALKER_VOICE_URL || 'ws://talker-voice:11995/ws';

const VOICE_ENABLED = Boolean(TALKER_AUTH_SECRET);

function mintToken(userId, projectPath) {
  const voiceSessionId = `web:s_${randomUUID()}`;
  const token = jwt.sign(
    {
      sub: `voice-${userId}`,
      project_path: projectPath,
      voice_session_id: voiceSessionId,
    },
    TALKER_AUTH_SECRET,
    { algorithm: 'HS256', expiresIn: '1d' },
  );
  return { token, voiceSessionId };
}

/**
 * GET /api/voice/status — tells the UI whether the voice sidecar is configured.
 */
router.get('/status', (_req, res) => {
  res.json({ enabled: VOICE_ENABLED });
});

/**
 * POST /api/voice/login?projectPath=...
 *
 * Auth endpoint consumed by the talker frontend SDK (serviceURLs.login). Mints
 * a talker access token bound to the project + a fresh voice session id. The
 * SDK appends this token to the /voice-ws connection, which the proxy forwards
 * to the talker sidecar.
 */
router.post('/login', (req, res) => {
  if (!VOICE_ENABLED) {
    return res.status(503).json({ error: 'Voice sidecar not configured.' });
  }
  // Empty projectPath = 🌐 global mode (no project bound; pure talker LLM chat).
  const projectPath = (req.query.projectPath || '').toString().trim();
  const userId = req.user?.id ?? req.user?.userId ?? 'voice-user';
  const { token, voiceSessionId } = mintToken(userId, projectPath);
  return res.json({
    access_token: token,
    user: { id: `voice-${userId}` },
    voiceSessionId,
  });
});

/**
 * GET /api/voice/settings — wake word / dismissal / idle settings for the UI.
 */
router.get('/settings', (_req, res) => {
  res.json({ enabled: VOICE_ENABLED, ...readVoiceSettings() });
});

/**
 * GET /api/voice/project-list
 *
 * Lists the projects the voice assistant can target/operate on. Consumed by the
 * talker sidecar to (a) inject available project names so the LLM can map a
 * spoken project name to a real one, and (b) resolve the `project` argument of
 * delegate_to_opcbrain to a concrete workspace path (fuzzy match on the
 * sidecar). Returns name / displayName / fullPath per project.
 *
 * Auth: inherits the /api/voice authenticateToken guard. In the default docker
 * deployment OPCBRAIN_DISABLE_LOCAL_AUTH=true, so the sidecar's tokenless call
 * resolves to the first DB user.
 */
router.get('/project-list', async (_req, res) => {
  try {
    const projects = await loadVoiceProjectList();
    return res.json({ projects });
  } catch (err) {
    console.error('[Voice] project-list failed:', err?.message || err);
    return res.status(500).json({ error: 'Failed to list projects.', projects: [] });
  }
});

/**
 * POST /api/voice/record
 *
 * Sidecar → ui-server per-turn conversation sync (Phase C). The talker sidecar
 * posts each completed voice turn (final ASR text + final spoken reply); we
 * append it to the canonical session transcript so voice chats show up in the
 * project's session history. Body: { projectPath?, sessionId, userText, assistantText }.
 * Empty projectPath records under the reserved 「全局助理」 workspace.
 */
router.post('/record', async (req, res) => {
  if (!VOICE_ENABLED) {
    return res.status(503).json({ error: 'Voice sidecar not configured.' });
  }
  const { projectPath, sessionId, userText, assistantText } = req.body || {};
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required.' });
  }
  try {
    const result = await recordVoiceExchange({ projectPath, sessionId, userText, assistantText });
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[Voice] record failed:', err?.message || err);
    return res.status(500).json({ error: 'Failed to record voice exchange.' });
  }
});

// The talker SDK derives sessions/upload URLs from the WS host. We override
// them to these voice-scoped stubs so they never collide with OPCBrain's own
// /api/sessions and /api/upload routes. The Voice panel does not use session
// history or uploads in v1.
router.get('/sessions', (_req, res) => res.json({ sessions: [] }));
router.get('/sessions/:id', (req, res) => res.json({ session_id: req.params?.id ?? null, title: null, messages: [] }));
router.post('/upload', (_req, res) => res.status(501).json({ error: 'Upload not supported in voice mode.' }));

export default router;
export { TALKER_VOICE_URL, VOICE_ENABLED };
