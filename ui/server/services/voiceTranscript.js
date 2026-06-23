/**
 * Voice conversation → session history sync (Phase C).
 *
 * Pure conversational voice turns (the talker LLM chatting, no delegation) never
 * pass through the OPC Brain gateway, so they would otherwise leave no trace in
 * the session history. This module appends those turns directly to the canonical
 * per-session JSONL transcript, reusing the SAME TypeScript writer/reader the
 * gateway uses (loaded via tsx — the UI server runs with `node --import tsx`).
 *
 * Delegation turns DO go through the gateway and are recorded under a separate
 * work session (``<voiceSessionId>:work`` / ``:<project>``), so the conversation
 * record (under the bare ``voiceSessionId``) never shares a transcript file with
 * a live gateway writer — no concurrent-writer races.
 *
 * Project-less ("global") voice chat is recorded under a reserved, visible
 * "全局助理" workspace rooted at ``<pilotHome>/global-assistant``.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { resolvePilotHome } from '../utils/pilotPaths.js';
import { createAgentProjectSessionStorage } from '../../../src/session/storage/ProjectSessionStorage.js';
import { readTranscript } from '../../../src/session/transcript/TranscriptReader.js';

const PILOT_HOME = resolvePilotHome(process.env);

/**
 * Reserved workspace that carries project-less (global) voice conversations.
 * Synthesized into the project list by `projects.js` (mirroring `general`) so
 * it is visible/selectable in the UI.
 */
export const GLOBAL_ASSISTANT = {
  name: 'global-assistant',
  displayName: '全局助理',
  root: path.join(PILOT_HOME, 'global-assistant'),
};

function textMessage(role, text) {
  return { role, content: [{ type: 'text', text }] };
}

/**
 * Append one voice exchange (user utterance + assistant reply) to a session
 * transcript without running the model.
 *
 * @param {object} args
 * @param {string} [args.projectPath] Absolute project root. Empty = 🌐 global → 全局助理.
 * @param {string} args.sessionId     The bare voice session id (e.g. `web:s_<uuid>`).
 * @param {string} [args.userText]    Final ASR transcript of what the user said.
 * @param {string} [args.assistantText] Final spoken reply from the assistant.
 */
export async function recordVoiceExchange({ projectPath, sessionId, userText, assistantText }) {
  const trimmedUser = (userText || '').trim();
  const trimmedAssistant = (assistantText || '').trim();
  if (!trimmedUser && !trimmedAssistant) {
    return { skipped: 'empty' };
  }
  if (!sessionId) {
    throw new Error('recordVoiceExchange: sessionId is required');
  }

  const projectRoot = (projectPath || '').trim() || GLOBAL_ASSISTANT.root;
  const storage = createAgentProjectSessionStorage({ projectRoot, pilotHome: PILOT_HOME, sessionId });

  // Continue the existing transcript's sequence / entry chain if the file
  // already has entries (so resume + future appends stay monotonic).
  const read = await readTranscript(storage.transcriptPath).catch(() => ({ entries: [] }));
  const firstTurn = read.entries.length === 0;
  if (!firstTurn) {
    const maxSeq = read.entries.reduce((m, e) => Math.max(m, e.sequence), 0);
    const last = read.entries[read.entries.length - 1];
    storage.transcript.restoreState(maxSeq, last.entryId ?? null);
  }

  const turnId = `voice_${randomUUID()}`;
  const nowIso = new Date().toISOString();
  const userMsg = textMessage('user', trimmedUser || '（无语音输入）');
  const assistantMsg = textMessage('assistant', trimmedAssistant || '（无回复）');

  // Stamp metadata on the first turn so the session lists with a title + tag.
  if (firstTurn && typeof storage.transcript.recordSessionMetadata === 'function') {
    await storage.transcript.recordSessionMetadata(sessionId, turnId, {
      title: (trimmedUser || '语音对话').slice(0, 60),
      firstPrompt: trimmedUser || undefined,
      tag: 'voice',
      updatedAt: nowIso,
    });
  }

  await storage.transcript.recordAcceptedInput(sessionId, turnId, [userMsg]);
  await storage.transcript.recordDurableMessage(sessionId, turnId, assistantMsg);
  await storage.transcript.recordTurnResult(sessionId, turnId, {
    type: 'success',
    sessionId,
    turnId,
    finalMessage: assistantMsg,
    stopReason: 'completed',
    usage: {},
    permissionDenials: [],
    turns: 1,
    startedAt: nowIso,
    completedAt: nowIso,
  });

  return { transcriptPath: storage.transcriptPath, turnId, projectRoot };
}
