// E2E test for the OPCBrain delegation path used by the talker voice tool.
// Mimics opcbrain_tool._run_opcbrain_turn: connect to the OPCBrain ui-server WS,
// send a "do real work" pilotdeck-command with bypassPermissions, collect the
// streamed reply + tool activity, and confirm OPCBrain actually executed.
const WebSocket = require('ws');

const URL = process.env.WS_URL || 'ws://127.0.0.1:3001/ws';
const PROJECT = process.env.PROJECT_PATH || '/workspace';
const TASK = process.env.TASK || '在当前项目根目录创建文件 hello-voice.txt，内容写 hi from voice。完成后简短确认。';

const ws = new WebSocket(URL);
let assistant = '';
const tools = [];
const kinds = {};
let done = false;

const timer = setTimeout(() => finish(2, 'timeout'), 120000);
function finish(code, why) {
  if (done) return;
  done = true;
  clearTimeout(timer);
  console.log('\n[delegate-test] kinds:', JSON.stringify(kinds));
  console.log('[delegate-test] tools used:', JSON.stringify([...new Set(tools)]));
  console.log('[delegate-test] assistant summary:', JSON.stringify(assistant.slice(0, 400)));
  console.log(`[delegate-test] result=${code} (${why})`);
  try { ws.close(); } catch {}
  process.exit(code);
}

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'pilotdeck-command',
    command: TASK,
    options: { projectPath: PROJECT, providerHint: 'pilotdeck', permissionMode: 'bypassPermissions' },
  }));
  console.log('[delegate-test] sent task to', PROJECT);
});

ws.on('message', (buf) => {
  let m; try { m = JSON.parse(buf.toString()); } catch { return; }
  const k = m.kind || m.type || '?';
  kinds[k] = (kinds[k] || 0) + 1;
  if (k === 'stream_delta') assistant += (m.content || m.text || '');
  if (k === 'tool_use') tools.push(m.toolName || m.name || '?');
  if (k === 'error') { console.log('[delegate-test] ERROR:', JSON.stringify(m).slice(0, 300)); finish(1, 'error'); }
  if (k === 'complete') finish(assistant.length || tools.length ? 0 : 1, 'complete');
});
ws.on('error', (e) => finish(3, 'ws error: ' + e.message));
