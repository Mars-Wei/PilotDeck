#!/usr/bin/env node
// Assemble apps/desktop/.backend-stage/ — the backend payload that
// electron-builder copies into the packaged app's Contents/Resources/backend.
//
// We copy the build artifacts + source, then run a fresh `npm install` inside
// the stage to materialize a FLAT node_modules. The repo uses a pnpm symlink
// farm, which electron-builder's resource copier silently drops — npm's flat
// layout (real dirs, only relative .bin symlinks) copies into the app cleanly,
// and native modules (better-sqlite3, node-pty, …) build for the system Node
// ABI here. Pruning to production-only + a bundled portable Node is the next
// (dmg) step.

import { execSync } from 'node:child_process';
import { rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const repoRoot = path.resolve(desktopDir, '..', '..');
const stage = path.join(desktopDir, '.backend-stage');

function run(cmd, cwd) {
  console.log(`\n[stage] $ ${cmd}  (cwd=${cwd})`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

// Copy build artifacts + source (no node_modules — installed fresh below).
// `src` is relative to repoRoot; copied into `destDir`.
function copy(src, destDir) {
  const from = path.join(repoRoot, src);
  console.log(`[stage] copy ${src}`);
  execSync(`cp -R ${JSON.stringify(from)} ${JSON.stringify(destDir)}`, { stdio: 'inherit' });
}

console.log('[stage] building backend artifacts…');
run('npm run build', repoRoot);            // → dist/, edgeclaw lib/, builtin plugins
run('npm run build', path.join(repoRoot, 'ui')); // → ui/dist/

console.log(`\n[stage] resetting ${stage}`);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
mkdirSync(path.join(stage, 'ui'), { recursive: true });

// Root payload (the file: edgeclaw dep + its prebuilt lib/ come with src/).
for (const item of ['package.json', 'src', 'dist']) {
  copy(item, stage);
}
// UI payload: built assets + the Express server + `shared/` (server imports
// ui/shared/*.js) + `scripts/` (ui's postinstall runs scripts/fix-node-pty.js
// during the stage `npm install`).
for (const item of ['package.json', 'server', 'dist', 'shared', 'scripts']) {
  copy(path.join('ui', item), path.join(stage, 'ui'));
}

// Materialize a flat, symlink-free node_modules (root + ui workspace) so
// electron-builder can bundle it; builds native modules for the system Node.
console.log('\n[stage] installing flat node_modules (npm, may take a few min)…');
run('npm install --no-audit --no-fund', stage);

console.log(`\n[stage] done → ${stage}`);
