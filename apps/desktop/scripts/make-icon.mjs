#!/usr/bin/env node
// Generate a placeholder 1024×1024 app icon from the existing (non-square) logo.
// electron-builder converts build/icon.png → .icns. This is a PLACEHOLDER —
// replace build/icon.png with real square art when available.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const repoRoot = path.resolve(desktopDir, '..', '..');

// sharp lives in the repo-root node_modules (apps/desktop isn't a workspace of
// root), so resolve it from there.
const require = createRequire(path.join(repoRoot, 'package.json'));
const sharp = require('sharp');

const logoPath = path.join(repoRoot, 'ui', 'src', 'assets', 'pilotdeck-logo.png');
const outDir = path.join(desktopDir, 'build');
const outPath = path.join(outDir, 'icon.png');

const SIZE = 1024;
const BG = { r: 10, g: 10, b: 10, alpha: 1 }; // brand dark (#0a0a0a)

mkdirSync(outDir, { recursive: true });

const logo = await sharp(logoPath)
  .resize({ width: Math.round(SIZE * 0.74), fit: 'inside' })
  .toBuffer();

await sharp({
  create: { width: SIZE, height: SIZE, channels: 4, background: BG },
})
  .composite([{ input: logo, gravity: 'center' }])
  .png()
  .toFile(outPath);

console.log(`[icon] wrote ${outPath} (${SIZE}×${SIZE}, placeholder)`);
