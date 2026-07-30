'use strict';

// Server manager for the OPC Brain desktop shell.
//
// Spawns the two backend processes we already run in dev — the gateway
// (`src/cli/pilotdeck.ts server`) and the UI Express server
// (`ui/server/index.js`) — under the *system* Node runtime via the `tsx`
// loader, then resolves once the UI server answers HTTP. The Electron window
// loads `http://127.0.0.1:<serverPort>`.
//
// Port probing mirrors scripts/dev-launcher.mjs (same env overrides). Vite is
// NOT started: in this mode the UI server serves the built ui/dist statically
// (ui/server/index.js → express.static('../dist')).

const { spawn } = require('node:child_process');
const net = require('node:net');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Backend root differs between a dev checkout and a packaged app:
//   - dev: the repo root (two levels up from apps/desktop)
//   - packaged: the staged backend tree under Contents/Resources/backend,
//     copied there via electron-builder `extraResources`.
// We read app.isPackaged when Electron is present, and fall back to probing for
// the packaged layout so this module stays usable outside Electron.
function resolveBackendRoot() {
  let packaged = false;
  try {
    packaged = require('electron').app?.isPackaged === true;
  } catch {
    packaged = false;
  }
  if (packaged && process.resourcesPath) {
    return path.join(process.resourcesPath, 'backend');
  }
  // Fallback: detect a packaged layout even if the electron require failed.
  if (process.resourcesPath) {
    const candidate = path.join(process.resourcesPath, 'backend');
    if (fs.existsSync(path.join(candidate, 'ui', 'server', 'index.js'))) {
      return candidate;
    }
  }
  return path.resolve(__dirname, '..', '..');
}

const repoRoot = resolveBackendRoot();
const uiDir = path.join(repoRoot, 'ui');

// Node binary to spawn the backend with. Packaged apps ship a portable Node
// under <backend>/.node/bin/node and must use it (a Finder launch has no shell
// PATH, and the native modules are ABI-matched to this Node). Dev uses the
// system `node`. Override with OPCBRAIN_NODE_BIN.
function resolveNodeBin() {
  if (process.env.OPCBRAIN_NODE_BIN) return process.env.OPCBRAIN_NODE_BIN;
  const bundled = path.join(repoRoot, '.node', 'bin', 'node');
  if (fs.existsSync(bundled)) return bundled;
  return 'node';
}

const GATEWAY_PORT_BASE = 18789;
// Keep the packaged desktop renderer on its own port range. Older releases
// reused :3001, so Chromium can have both an HTTP cache and a PWA worker tied
// to that origin even after the app bundle is upgraded.
const SERVER_PORT_BASE = 43101;
// The desktop UI is only consumed by the local Electron window. Binding it to
// loopback also keeps port probing and the eventual listen() call on the exact
// same interface. This matters on macOS where Docker Desktop can hold an IPv6
// wildcard port while a temporary IPv4 loopback probe still succeeds.
const UI_HOST = '127.0.0.1';
const MAX_PORT_TRIES = 20;
const READY_TIMEOUT_MS = 45_000;
const STOP_GRACE_MS = 4_000;

const NODE_BIN = resolveNodeBin();
const isWin = process.platform === 'win32';

/** @type {{ name: string, child: import('child_process').ChildProcess }[]} */
const children = [];
let stopping = false;

function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

function envPortOverride(name) {
  const raw = process.env[name];
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function findFreePort(label, base, hardOverride) {
  if (hardOverride !== undefined) return hardOverride;
  for (let offset = 0; offset < MAX_PORT_TRIES; offset += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(base + offset)) return base + offset;
  }
  throw new Error(`Could not find a free ${label} port within ${MAX_PORT_TRIES} of ${base}.`);
}

function waitForHttp(port, { timeoutMs = READY_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (stopping) return reject(new Error('Startup aborted'));
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 2_000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', retry);
      req.on('timeout', () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() >= deadline) {
        reject(new Error(`UI server did not become ready on :${port} within ${timeoutMs}ms`));
      } else {
        setTimeout(attempt, 400);
      }
    };
    attempt();
  });
}

function spawnChild(name, args, cwd, extraEnv) {
  const child = spawn(NODE_BIN, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'inherit', 'inherit'],
    // Group leader on posix so stop() can reap the whole tree via -pid.
    detached: !isWin,
  });
  child.on('exit', (code, signal) => {
    const idx = children.findIndex((c) => c.child === child);
    if (idx !== -1) children.splice(idx, 1);
    if (!stopping && (code ?? 0) !== 0) {
      onChildCrash?.(name, code, signal);
    }
  });
  children.push({ name, child });
  return child;
}

let onChildCrash = null;

/**
 * Start the backend. Resolves with the resolved ports once the UI server is
 * reachable over HTTP.
 * @param {(name:string, code:number|null, signal:string|null)=>void} [crashHandler]
 */
async function start(crashHandler) {
  onChildCrash = crashHandler || null;
  stopping = false;

  const gatewayPort = await findFreePort('gateway', GATEWAY_PORT_BASE, envPortOverride('OPCBRAIN_GATEWAY_PORT'));
  const serverPort = await findFreePort('server', SERVER_PORT_BASE, envPortOverride('SERVER_PORT'));

  console.log(`[desktop] backendRoot = ${repoRoot}`);
  console.log(`[desktop] NODE_BIN = ${NODE_BIN}`);
  console.log(`[desktop] gateway → :${gatewayPort}, ui-server → :${serverPort}`);

  // Gateway first: it writes ~/.opcbrain/server-token, which the UI server's
  // pilotdeck-bridge reads (with its own 30s retry), so the order is forgiving.
  spawnChild('gateway', ['--import', 'tsx', 'src/cli/pilotdeck.ts', 'server'], repoRoot, {
    OPCBRAIN_GATEWAY_PORT: String(gatewayPort),
    OPCBRAIN_SKIP_DEFAULT_PROJECT: '1',
  });

  spawnChild('ui-server', ['--import', 'tsx', 'server/index.js'], uiDir, {
    SERVER_PORT: String(serverPort),
    HOST: UI_HOST,
    OPCBRAIN_GATEWAY_URL: `ws://127.0.0.1:${gatewayPort}/ws`,
    OPCBRAIN_DESKTOP: '1',
    OPCBRAIN_SKIP_BROWSER_OPEN: '1',
  });

  await waitForHttp(serverPort);
  // Use a desktop-only origin. Legacy releases used 127.0.0.1, where an old
  // PWA service worker may still control navigation before Electron can purge
  // it. localhost reaches the same loopback server without inheriting that
  // stale worker scope.
  return {
    serverPort,
    gatewayPort,
    url: `http://opcbrain-desktop.localhost:${serverPort}/?desktop=1`,
  };
}

function killChild(name, child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (isWin) {
      child.kill('SIGTERM');
    } else if (child.pid) {
      // Negative pid → kill the process group (reaps tsx + grandchildren).
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    // already gone
  }
}

/** Stop all child processes, escalating to SIGKILL after a grace period. */
async function stop() {
  stopping = true;
  const snapshot = children.slice();
  for (const { name, child } of snapshot) killChild(name, child);

  await new Promise((resolve) => setTimeout(resolve, STOP_GRACE_MS));

  for (const { child } of children.slice()) {
    try {
      if (!isWin && child.pid) process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch {
      // gone
    }
  }
}

module.exports = { start, stop, repoRoot, uiDir };
