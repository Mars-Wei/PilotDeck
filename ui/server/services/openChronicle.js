import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';

export const OPENCHRONICLE_SERVER_NAME = 'openchronicle';
export const OPENCHRONICLE_DEFAULT_URL = 'http://127.0.0.1:8742/mcp';

// Resolve the OpenChronicle install root (~/.openchronicle by default). The
// daemon stores durable Markdown memory under memory/ and a SQLite index at
// index.db (FTS5 over both durable entries and raw screen captures).
export function getOpenChronicleRoot() {
  return process.env.OPENCHRONICLE_ROOT || path.join(os.homedir(), '.openchronicle');
}

function getMemoryDir() {
  return path.join(getOpenChronicleRoot(), 'memory');
}

function getIndexDbPath() {
  return path.join(getOpenChronicleRoot(), 'index.db');
}

export const OPENCHRONICLE_INSTRUCTIONS = [
  'OpenChronicle is the user\'s local desktop-context memory. It exposes recent screen/app context, raw captures, and durable Markdown memory.',
  'Use it when the user refers to the current screen, recent activity, "this/that/the page/the error/the file", or asks what they were doing.',
  'Prefer current_context for present-tense questions, search_captures for exact recent strings such as errors/code/URLs, and search/read_memory for durable project, person, preference, or decision context.',
  'Do not use OpenChronicle when the task is fully specified in the chat, when the user explicitly asks not to use prior context, or when a live authoritative source is required.',
].join('\n');

export function buildOpenChronicleMcpServer(url = OPENCHRONICLE_DEFAULT_URL) {
  return {
    url,
    instructions: OPENCHRONICLE_INSTRUCTIONS,
  };
}

export async function getOpenChronicleStatus(url = OPENCHRONICLE_DEFAULT_URL) {
  const normalizedUrl = normalizeMcpUrl(url);
  const [daemon, install] = await Promise.all([
    probeDaemon(normalizedUrl),
    probeInstall(),
  ]);

  return {
    name: OPENCHRONICLE_SERVER_NAME,
    url: normalizedUrl,
    configuredServer: buildOpenChronicleMcpServer(normalizedUrl),
    ...daemon,
    ...install,
  };
}

async function probeDaemon(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    // MCP streamable HTTP endpoints may reject plain GET with 405 while still
    // proving that the daemon is alive. Treat any HTTP response as reachable.
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json, text/event-stream' },
      signal: controller.signal,
    });
    return {
      reachable: true,
      httpStatus: response.status,
      health: response.ok ? 'ready' : 'reachable',
    };
  } catch (error) {
    return {
      reachable: false,
      health: 'unreachable',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeInstall() {
  const root = getOpenChronicleRoot();
  const [configExists, pidExists, memoryExists] = await Promise.all([
    fileExists(path.join(root, 'config.toml')),
    fileExists(path.join(root, '.pid')),
    fileExists(path.join(root, 'memory')),
  ]);

  return {
    root,
    installed: configExists || pidExists || memoryExists,
    configExists,
    daemonPidFileExists: pidExists,
    memoryDirExists: memoryExists,
  };
}

async function fileExists(filePath) {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeMcpUrl(url) {
  return typeof url === 'string' && url.trim() ? url.trim() : OPENCHRONICLE_DEFAULT_URL;
}

// ---------------------------------------------------------------------------
// Memory browsing
//
// "Today's memory" and the Markdown file list/content are served straight from
// the filesystem (memory/*.md) so they keep working even if the SQLite index is
// absent or locked. Full-text search over durable entries and raw captures uses
// index.db (better-sqlite3, read-only); when the DB is missing those endpoints
// degrade to { available: false } instead of throwing.
// ---------------------------------------------------------------------------

let cachedSqlite;
async function loadSqlite() {
  if (cachedSqlite !== undefined) return cachedSqlite;
  try {
    const mod = await import('better-sqlite3');
    cachedSqlite = mod.default || mod;
  } catch {
    cachedSqlite = null;
  }
  return cachedSqlite;
}

async function openIndexDb() {
  const dbPath = getIndexDbPath();
  if (!(await fileExists(dbPath))) return null;
  const Database = await loadSqlite();
  if (!Database) return null;
  try {
    return new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

// Turn arbitrary user text into a safe FTS5 prefix query. Each whitespace token
// is quoted (doubling embedded quotes) and given a trailing * for prefix match,
// which sidesteps FTS5 syntax errors on punctuation in the raw input.
function toFtsQuery(raw) {
  const tokens = String(raw || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token.replace(/"/g, '""')}"*`);
  return tokens.join(' ');
}

function todayStamp() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function resolveMemoryFile(relativePath) {
  const memoryDir = getMemoryDir();
  const resolved = path.resolve(memoryDir, relativePath || '');
  const prefix = memoryDir.endsWith(path.sep) ? memoryDir : memoryDir + path.sep;
  if (resolved !== memoryDir && !resolved.startsWith(prefix)) {
    throw new Error('Invalid memory file path');
  }
  return resolved;
}

export async function listOpenChronicleMemoryFiles() {
  const memoryDir = getMemoryDir();
  let names;
  try {
    names = await fsPromises.readdir(memoryDir);
  } catch {
    return { available: false, files: [] };
  }
  const files = [];
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    try {
      const stat = await fsPromises.stat(path.join(memoryDir, name));
      if (!stat.isFile()) continue;
      files.push({
        path: name,
        prefix: name.split('-')[0],
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
      });
    } catch {
      // skip unreadable entries
    }
  }
  files.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { available: true, files };
}

export async function readOpenChronicleMemoryFile(relativePath) {
  const resolved = resolveMemoryFile(relativePath);
  const content = await fsPromises.readFile(resolved, 'utf-8');
  return { path: relativePath, content };
}

export async function getOpenChronicleMemoryToday() {
  const stamp = todayStamp();
  const relativePath = `event-${stamp}.md`;
  try {
    const { content } = await readOpenChronicleMemoryFile(relativePath);
    return { available: true, date: stamp, path: relativePath, content };
  } catch {
    return { available: false, date: stamp, path: relativePath, content: '' };
  }
}

export async function searchOpenChronicleEntries(query, { limit = 30 } = {}) {
  const match = toFtsQuery(query);
  if (!match) return { available: true, query, results: [] };
  const db = await openIndexDb();
  if (!db) return { available: false, query, results: [] };
  try {
    const rows = db
      .prepare(
        `SELECT id, path, prefix, timestamp, tags, content
         FROM entries
         WHERE entries MATCH ? AND superseded = 0
         ORDER BY rank
         LIMIT ?`,
      )
      .all(match, limit);
    return { available: true, query, results: rows };
  } catch {
    return { available: false, query, results: [] };
  } finally {
    db.close();
  }
}

export async function searchOpenChronicleCaptures(query, { limit = 30 } = {}) {
  const match = toFtsQuery(query);
  if (!match) return { available: true, query, results: [] };
  const db = await openIndexDb();
  if (!db) return { available: false, query, results: [] };
  try {
    const rows = db
      .prepare(
        `SELECT c.id, c.timestamp, c.app_name, c.window_title, c.url,
                snippet(captures_fts, 3, '[', ']', ' … ', 12) AS snippet
         FROM captures_fts
         JOIN captures c ON c.rowid = captures_fts.rowid
         WHERE captures_fts MATCH ?
         ORDER BY c.timestamp DESC
         LIMIT ?`,
      )
      .all(match, limit);
    return { available: true, query, results: rows };
  } catch {
    return { available: false, query, results: [] };
  } finally {
    db.close();
  }
}

export async function listOpenChronicleRecentCaptures({ limit = 50 } = {}) {
  const db = await openIndexDb();
  if (!db) return { available: false, results: [] };
  try {
    const rows = db
      .prepare(
        `SELECT id, timestamp, app_name, window_title, url,
                substr(visible_text, 1, 200) AS preview
         FROM captures
         ORDER BY timestamp DESC
         LIMIT ?`,
      )
      .all(limit);
    return { available: true, results: rows };
  } catch {
    return { available: false, results: [] };
  } finally {
    db.close();
  }
}
