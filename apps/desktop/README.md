# OPC Brain Desktop (Electron)

A native desktop shell around the existing OPC Brain web app. The Electron main
process spawns the **gateway** and the **UI Express server** as child processes
(under your system Node, via `tsx`) and renders the existing React UI in a
window — no browser tab, no login.

This is **P1 (MVP)**: it runs from source for local development. Packaging,
native-module bundling, auto-update, tray, etc. are later phases (see Roadmap).

## Run (P1)

```bash
# 1. Install Electron (once)
cd apps/desktop && npm install

# 2. Make sure the UI bundle exists (the desktop window loads the built UI)
cd ../../ui && npm run build      # only needed if ui/dist is missing/stale

# 3. Launch the desktop app
cd ../apps/desktop && npm run dev
```

A window opens, shows a brief "正在启动本地服务…" screen while the backend boots,
then loads the app. Backend logs stream to the terminal you launched from.

Requirements: **Node 22+** on your PATH (the backend uses `node:sqlite`). Override
the binary with `OPCBRAIN_NODE_BIN=/path/to/node` if `node` isn't the right one.

## How it works

`main.js` → `server-manager.js`:

1. Probe two free ports (gateway base `18789`, server base `3001`) — same env
   overrides as the dev launcher (`OPCBRAIN_GATEWAY_PORT`, `SERVER_PORT`).
2. Spawn the **gateway** (`src/cli/pilotdeck.ts server`) and the **UI server**
   (`ui/server/index.js`) with `tsx`. Vite is *not* started — the UI server
   serves the built `ui/dist` statically.
3. Wait until the UI server answers HTTP, then `loadURL` it in the window.
4. On quit, kill both child process groups (SIGTERM → SIGKILL grace).

Env injected into the children (all pre-existing flags in the codebase):

| Var | Value | Effect |
|---|---|---|
| `OPCBRAIN_GATEWAY_PORT` | probed | gateway bind port |
| `SERVER_PORT` | probed | UI server bind port |
| `OPCBRAIN_GATEWAY_URL` | `ws://127.0.0.1:<gw>/ws` | UI↔gateway bridge target |
| `OPCBRAIN_DESKTOP` | `1` | suppress browser auto-open |
| `OPCBRAIN_SKIP_BROWSER_OPEN` | `1` | (belt-and-suspenders) |
| `OPCBRAIN_SKIP_DEFAULT_PROJECT` | `1` | don't auto-create a default project |

Login is already off in desktop/local mode via `DISABLE_LOCAL_AUTH` (default true).

## Packaging (P2a — unpacked `.app`)

```bash
cd apps/desktop && npm run pack:dir
```

This (1) builds the backend + UI, (2) stages a self-contained backend payload in
`.backend-stage/` — build artifacts + `src/` + a **flat `npm install`** node_modules
(symlink-free, so electron-builder can bundle it; native modules built for the system Node),
and (3) runs `electron-builder --dir`, producing:

```
apps/desktop/release/mac-arm64/OPC Brain.app
```

An `afterPack` hook (`scripts/after-pack.cjs`) copies the staged backend into the app's
`Contents/Resources/backend` — electron-builder's `extraResources` matcher silently drops
`node_modules`, so we copy it ourselves. At runtime `server-manager.js` detects the packaged
layout (`app.isPackaged`) and resolves the backend from `process.resourcesPath/backend`.

Run it: `open "release/mac-arm64/OPC Brain.app"`.

## Build a `.dmg` (P2b — self-contained, ad-hoc signed)

```bash
cd apps/desktop && npm run dist
```

On top of staging, this:
- downloads + bundles a pinned **portable Node (v24.18.0, darwin-arm64)** into the payload
  (`.node/bin/node`), and runs the stage `npm install` **under that Node** so native modules
  (`better-sqlite3`, `node-pty`, …) are ABI-matched to the runtime;
- `npm prune --omit=dev` to shrink (~594 MB → ~412 MB);
- generates a placeholder icon (`scripts/make-icon.mjs` → `build/icon.png`);
- runs electron-builder with the `dmg` target → `release/OPC Brain-<ver>-arm64.dmg` (~264 MB);
- the `afterPack` hook copies the backend in, then **ad-hoc signs** the whole `.app`
  (`codesign --force --deep --sign -`) so it runs on Apple Silicon. This is free and needs no
  Apple account, but the app is **not notarized**.

At runtime `server-manager.js` spawns the backend under the bundled Node
(`<backend>/.node/bin/node`), so the app needs **no system Node** and works when launched from
Finder (no shell PATH). Verified by launching with a stripped PATH.

### Installing a downloaded build (Gatekeeper)

Because the build is ad-hoc signed but **not notarized**, macOS quarantines it on download and
shows “unverified developer” / “damaged” on first open. Bypass it once:

- **Right-click the app → Open → Open** (then it's remembered), or
- System Settings → Privacy & Security → **“Open Anyway”**, or
- strip the quarantine flag: `xattr -dr com.apple.quarantine "/Applications/OPC Brain.app"`.

This is normal for open-source macOS apps. To remove the prompt entirely you'd need a paid
**Apple Developer ID** signature + notarization (deferred — see roadmap).

## Caveats (P1)

- **Voice wake word** relies on Chrome's cloud `webkitSpeechRecognition`, which
  Electron's Chromium lacks → the wake word won't trigger here. Click/push-to-talk
  voice (mic → `/voice-ws` → talker sidecar) can work once mic permission is
  granted; a local-ASR wake word is a P4 item. Voice env (`TALKER_AUTH_SECRET`)
  is not injected by the desktop shell in P1.
- Optional sidecars (OpenChronicle daemon, talker-voice) are external and
  unmanaged in P1 — start them yourself if you need 工作记忆 / voice.

## Roadmap

- **P2a — Packaging-readiness** ✅: `electron-builder --dir` unpacked `.app`; packaged-path
  resolution; flat-`node_modules` staging + `afterPack` backend copy.
- **P2b — Self-contained `.dmg`** ✅: bundled portable Node v24.18.0 + spawn under it (no system
  Node dependency); `npm prune --omit=dev`; placeholder icon; ad-hoc signed `dmg` target.
- **P2c — Distribution polish**: code-signing / notarization (Apple Developer ID); real icon
  art; `.exe` / AppImage for cross-platform.
- **P3 — Native integration**: tray, launch-at-login, native notifications, deep links,
  auto-update.
- **P4 — Sidecars & polish**: OpenChronicle/voice install & management UX, local-ASR wake word.
