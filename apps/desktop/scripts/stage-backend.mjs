#!/usr/bin/env node
// Assemble apps/desktop/.backend-stage/ — the backend payload that
// electron-builder copies into the packaged app's Contents/Resources/backend.
//
// Key points:
//  - node_modules is materialized via a fresh, FLAT `npm install` (the repo's
//    pnpm symlink farm doesn't survive bundling).
//  - The install runs under a BUNDLED portable Node (not the system Node) so
//    native modules (better-sqlite3, node-pty, bcrypt, sqlite3) match the ABI of
//    the Node we ship and spawn at runtime.
//  - We then `npm prune --omit=dev` to drop build-only deps, and copy the Node
//    binary into the payload (.node/bin/node).

import { execSync } from 'node:child_process';
import { rmSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const repoRoot = path.resolve(desktopDir, '..', '..');
const stage = path.join(desktopDir, '.backend-stage');

// Pinned portable Node bundled into the app (darwin-arm64). node:sqlite works
// flag-free here; bump deliberately (and re-stage so natives rebuild).
const NODE_VERSION = 'v24.18.0';
const NODE_DIST = `node-${NODE_VERSION}-darwin-arm64`;
const cacheDir = path.join(desktopDir, '.cache');
const nodeDistDir = path.join(cacheDir, NODE_DIST);
const bundledBin = path.join(nodeDistDir, 'bin');

function run(cmd, cwd, env) {
  console.log(`\n[stage] $ ${cmd}  (cwd=${cwd})`);
  execSync(cmd, { cwd, stdio: 'inherit', env: env || process.env });
}

// `cp -R` preserves the (few) relative symlinks npm leaves. `src` is relative
// to repoRoot; copied into `destDir`.
function copy(src, destDir) {
  const from = path.join(repoRoot, src);
  console.log(`[stage] copy ${src}`);
  execSync(`cp -R ${JSON.stringify(from)} ${JSON.stringify(destDir)}`, { stdio: 'inherit' });
}

// Download + extract the portable Node into the cache (idempotent).
function ensureBundledNode() {
  if (existsSync(path.join(bundledBin, 'node'))) {
    console.log(`[stage] bundled Node present: ${NODE_DIST}`);
    return;
  }
  mkdirSync(cacheDir, { recursive: true });
  const tarball = `${NODE_DIST}.tar.gz`;
  const tarPath = path.join(cacheDir, tarball);
  if (!existsSync(tarPath)) {
    run(`curl -fL -o ${JSON.stringify(tarPath)} https://nodejs.org/dist/${NODE_VERSION}/${tarball}`, desktopDir);
  }
  run(`tar -xzf ${JSON.stringify(tarPath)} -C ${JSON.stringify(cacheDir)}`, desktopDir);
}

// 1. Build backend artifacts (uses system Node — build-time only, ABI-irrelevant).
console.log('[stage] building backend artifacts…');
run('npm run build', repoRoot);                   // → dist/, edgeclaw lib/, builtin plugins
run('npm run build', path.join(repoRoot, 'ui'));  // → ui/dist/

// 2. Fetch the portable Node we'll install under and ship.
ensureBundledNode();

// 3. Reset the stage and copy source/build payload (no node_modules yet).
console.log(`\n[stage] resetting ${stage}`);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
mkdirSync(path.join(stage, 'ui'), { recursive: true });

for (const item of ['package.json', 'src', 'dist']) {
  copy(item, stage);
}
// UI payload: built assets + Express server + shared/ (server imports
// ui/shared/*.js) + scripts/ (ui postinstall runs scripts/fix-node-pty.js).
for (const item of ['package.json', 'server', 'dist', 'shared', 'scripts']) {
  copy(path.join('ui', item), path.join(stage, 'ui'));
}

// 4. Install + prune under the BUNDLED Node (prepend its bin to PATH so npm and
//    node-gyp resolve the bundled `node` via `#!/usr/bin/env node`).
const bundledEnv = { ...process.env, PATH: `${bundledBin}:${process.env.PATH}` };
run('node -v && npm -v', stage, bundledEnv); // sanity: should print the bundled versions
console.log('\n[stage] installing flat node_modules under bundled Node (may take a few min)…');
run('npm install --no-audit --no-fund', stage, bundledEnv);
console.log('\n[stage] pruning dev dependencies…');
run('npm prune --omit=dev', stage, bundledEnv);

// 5. Ship the Node binary inside the payload (.node/bin/node).
mkdirSync(path.join(stage, '.node', 'bin'), { recursive: true });
execSync(
  `cp ${JSON.stringify(path.join(bundledBin, 'node'))} ${JSON.stringify(path.join(stage, '.node', 'bin', 'node'))}`,
  { stdio: 'inherit' },
);

console.log(`\n[stage] done → ${stage} (bundled ${NODE_VERSION})`);
