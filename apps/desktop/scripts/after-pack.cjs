'use strict';

// electron-builder afterPack hook.
//
// We copy the staged backend (apps/desktop/.backend-stage) into the packaged
// app's Contents/Resources/backend ourselves, because electron-builder's
// `extraResources` matcher silently drops `node_modules` directories. `cp -R`
// preserves the (few) relative symlinks the flat npm install leaves behind.

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  if (electronPlatformName !== 'darwin') {
    // P2a targets macOS; other platforms handled in a later phase.
    return;
  }

  const productName = packager.appInfo.productFilename; // "OPC Brain"
  const stage = path.join(__dirname, '..', '.backend-stage');
  const dest = path.join(
    appOutDir,
    `${productName}.app`,
    'Contents',
    'Resources',
    'backend',
  );

  if (!fs.existsSync(stage)) {
    throw new Error(`[after-pack] backend stage not found: ${stage} (run "npm run stage")`);
  }

  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  execSync(`cp -R ${JSON.stringify(stage)} ${JSON.stringify(dest)}`, { stdio: 'inherit' });
  console.log(`[after-pack] backend payload copied → ${dest}`);
};
