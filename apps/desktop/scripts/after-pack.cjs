'use strict';

// electron-builder afterPack hook.
//
// 1. We copy the staged backend (apps/desktop/.backend-stage) into the packaged
//    app's Contents/Resources/backend ourselves, because electron-builder's
//    `extraResources` matcher silently drops `node_modules` directories. `cp -R`
//    preserves the (few) relative symlinks the flat npm install leaves behind.
// 2. Adding files into the bundle breaks the app's code-signature seal, so we
//    re-sign the whole .app with an AD-HOC identity (free, no Apple account).
//    On Apple Silicon an app must be at least ad-hoc signed to run; without this
//    a downloaded build is killed as "damaged". It is NOT notarized, so users
//    still bypass Gatekeeper once on first open (see README).

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

  // Re-seal the bundle with an ad-hoc signature (identity "-") now that its
  // contents are final. --deep covers the nested Electron framework/helpers and
  // the bundled node/native binaries.
  const appPath = path.join(appOutDir, `${productName}.app`);
  execSync(`codesign --force --deep --sign - ${JSON.stringify(appPath)}`, { stdio: 'inherit' });
  execSync(`codesign --verify --deep --strict ${JSON.stringify(appPath)}`, { stdio: 'inherit' });
  console.log(`[after-pack] ad-hoc signed + verified → ${appPath}`);
};
