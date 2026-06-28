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

## Caveats (P1)

- **Voice wake word** relies on Chrome's cloud `webkitSpeechRecognition`, which
  Electron's Chromium lacks → the wake word won't trigger here. Click/push-to-talk
  voice (mic → `/voice-ws` → talker sidecar) can work once mic permission is
  granted; a local-ASR wake word is a P4 item. Voice env (`TALKER_AUTH_SECRET`)
  is not injected by the desktop shell in P1.
- Optional sidecars (OpenChronicle daemon, talker-voice) are external and
  unmanaged in P1 — start them yourself if you need 工作记忆 / voice.

## Roadmap

- **P2 — Packaging**: `electron-builder` (.dmg/.exe/AppImage); decide
  portable-Node vs `electron-rebuild` for `better-sqlite3`/`node:sqlite`; run
  compiled `dist/` instead of `tsx`; first-run config bootstrap; signing/notarization.
- **P3 — Native integration**: tray, launch-at-login, native notifications,
  deep links, auto-update.
- **P4 — Sidecars & polish**: OpenChronicle/voice install & management UX,
  local-ASR wake word.
