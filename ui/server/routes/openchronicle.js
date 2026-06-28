import express from 'express';
import {
  OPENCHRONICLE_DEFAULT_URL,
  getOpenChronicleStatus,
  getOpenChronicleMemoryToday,
  searchOpenChronicleEntries,
  searchOpenChronicleCaptures,
  listOpenChronicleMemoryFiles,
  readOpenChronicleMemoryFile,
  listOpenChronicleRecentCaptures,
} from '../services/openChronicle.js';

const router = express.Router();

function parseLimit(value, fallback, max = 200) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, parsed));
}

router.get('/status', async (req, res) => {
  try {
    const url = typeof req.query.url === 'string' ? req.query.url : OPENCHRONICLE_DEFAULT_URL;
    const status = await getOpenChronicleStatus(url);
    res.json({ success: true, status });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check OpenChronicle status', details: error.message });
  }
});

router.get('/memory/today', async (_req, res) => {
  try {
    res.json({ success: true, ...(await getOpenChronicleMemoryToday()) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read today\'s memory', details: error.message });
  }
});

router.get('/memory/search', async (req, res) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const limit = parseLimit(req.query.limit, 30);
    const kind = req.query.kind === 'captures' ? 'captures' : 'memory';
    const result = kind === 'captures'
      ? await searchOpenChronicleCaptures(query, { limit })
      : await searchOpenChronicleEntries(query, { limit });
    res.json({ success: true, kind, ...result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to search OpenChronicle memory', details: error.message });
  }
});

router.get('/memory/files', async (_req, res) => {
  try {
    res.json({ success: true, ...(await listOpenChronicleMemoryFiles()) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list memory files', details: error.message });
  }
});

router.get('/memory/file', async (req, res) => {
  try {
    const relativePath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!relativePath) {
      return res.status(400).json({ error: 'path query parameter is required' });
    }
    const result = await readOpenChronicleMemoryFile(relativePath);
    res.json({ success: true, ...result });
  } catch (error) {
    const status = error.code === 'ENOENT' ? 404 : 400;
    res.status(status).json({ error: 'Failed to read memory file', details: error.message });
  }
});

router.get('/captures/recent', async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 50);
    res.json({ success: true, ...(await listOpenChronicleRecentCaptures({ limit })) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list recent captures', details: error.message });
  }
});

export default router;
