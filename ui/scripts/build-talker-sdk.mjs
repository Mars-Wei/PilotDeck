#!/usr/bin/env node
/**
 * Build the talker frontend SDK and vendor the ESM bundle + runtime assets into
 * ui/public/talker/ so the Voice panel can load it same-origin via
 * `import('/talker/index.js')`.
 *
 * Usage:
 *   node ui/scripts/build-talker-sdk.mjs            # copy existing dist
 *   TALKER_FRONTEND=/path/to/talker/frontend \
 *     node ui/scripts/build-talker-sdk.mjs --build  # rebuild then copy
 *
 * The talker repo lives outside this repo, so its path is resolved from the
 * TALKER_FRONTEND env var (default: ../talker/frontend relative to repo root).
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const talkerFrontend =
  process.env.TALKER_FRONTEND ||
  path.resolve(repoRoot, '..', 'talker', 'frontend');
const distDir = path.join(talkerFrontend, 'dist');
const outDir = path.resolve(repoRoot, 'ui', 'public', 'talker');

const shouldBuild = process.argv.includes('--build');

if (!fs.existsSync(talkerFrontend)) {
  console.error(`[talker-sdk] talker frontend not found at ${talkerFrontend}.`);
  console.error('[talker-sdk] Set TALKER_FRONTEND to the talker/frontend path.');
  process.exit(1);
}

if (shouldBuild) {
  console.log(`[talker-sdk] Building SDK in ${talkerFrontend} ...`);
  if (!fs.existsSync(path.join(talkerFrontend, 'node_modules'))) {
    execSync('npm install', { cwd: talkerFrontend, stdio: 'inherit' });
  }
  execSync('npm run build', { cwd: talkerFrontend, stdio: 'inherit' });
}

if (!fs.existsSync(distDir)) {
  console.error(`[talker-sdk] dist not found at ${distDir}. Re-run with --build.`);
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// ESM entry consumed by the Voice panel.
fs.copyFileSync(path.join(distDir, 'index.js'), path.join(outDir, 'index.js'));

// Runtime assets referenced by index.js with publicPath:auto.
for (const sub of ['worklets', 'models']) {
  const src = path.join(distDir, sub);
  if (fs.existsSync(src)) {
    fs.cpSync(src, path.join(outDir, sub), { recursive: true });
  }
}

console.log(`[talker-sdk] Vendored SDK -> ${outDir}`);
