# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

OPC Brain is an open-source agent operating system built around the "WorkSpace" concept. It is a TypeScript/Node.js backend with a React-based Web UI. The system provides WorkSpace-level isolation, white-box memory, smart model routing, always-on background execution, and native MCP support.

## Build, Test & Development Commands

### Prerequisites
- Node.js 22+
- pnpm (used for workspace management; `npm install` at root also works)
- Git LFS (for media assets; skip with `GIT_LFS_SKIP_SMUDGE=1` if not needed)

### Install Dependencies
```bash
npm install              # root deps (gateway runtime)
cd ui && npm install     # UI deps
cd ..
```

### Development
```bash
npm run dev              # Start full dev stack: probes free ports, runs gateway + UI server + Vite
npm run server           # Start only the gateway server (WebSocket + HTTP)
```

The dev launcher (`scripts/dev-launcher.mjs`) probes for free ports starting at 3001 (server), 18789 (gateway), 5173 (Vite) and injects them into the concurrently-run services. Override via env: `SERVER_PORT`, `PILOTDECK_GATEWAY_PORT`, `VITE_PORT` (hard-pin), or `SERVER_PORT_BASE`, `PILOTDECK_GATEWAY_PORT_BASE`, `VITE_PORT_BASE` (probe from a different base). Port config can also live in `~/.pilotdeck/pilotdeck.yaml` under `webui.runtime.serverPort` / `vitePort`.

UI-only development (when gateway is already running):
```bash
cd ui && npm run dev:client     # Vite dev server only (HMR)
cd ui && npm run dev:server     # UI Express server only
cd ui && npm run server         # Production UI server (built assets)
```

### Build
```bash
npm run build            # Full build: bootstraps config, builds edgeclaw-memory-core, compiles TS to dist/, copies builtin plugins
```
The `prebuild` step builds the `edgeclaw-memory-core` sub-package (in `src/context/memory/edgeclaw-memory-core/`).

### Testing
```bash
# Root tests (Node.js built-in test runner)
npm run test             # Build then run dist/tests/**/*.test.js with 60s timeout

# Run a single root test file
node --test --test-force-exit --test-timeout 60000 dist/tests/path/to/single.test.js

# UI tests (Vitest)
cd ui && npm run test    # Run vitest once
cd ui && npm run test:watch   # Watch mode

# Run a single UI test file
cd ui && npx vitest run src/path/to/single.test.ts

# E2E
npm run e2e:real-agent-lifecycle-hooks   # Real agent lifecycle hooks e2e test
```

### Lint / Typecheck
```bash
cd ui && npm run lint         # ESLint on ui/src/
cd ui && npm run lint:fix     # Auto-fix
cd ui && npm run typecheck    # tsc --noEmit
```

### Running the Built Server
```bash
npm run server:built     # Run compiled dist/src/cli/pilotdeck.js server
```

### Skills Migration
```bash
npm run skills:migrate   # Migrate skills into OPC Brain
```

## High-Level Architecture

### Core Subsystems

The codebase is organized around these major subsystems in `src/`:

- **`gateway/`** — Central orchestrator. `SessionRouter` manages agent sessions. `InProcessGateway` is the concrete implementation. The gateway creates agent sessions via `createAgentSession` and routes turns between channels and agents.
- **`agent/`** — Core agent execution engine. `AgentLoop` drives turn-based execution: collects tool calls from the model, executes them (concurrently where safe), pairs results, and decides loop continuation. Supports subagent forks via the `agent` tool. `AgentSession` manages session state and transcript writing.
- **`context/`** — Context management layer. Handles prompt assembly, message projection, token budgeting, context compaction (snip, micro, full), overflow recovery, and memory. The `EdgeClawMemoryProvider` (backed by `edgeclaw-memory-core`) provides white-box memory capture and retrieval.
- **`model/`** — LLM provider abstraction. Converts provider-specific APIs (Anthropic, OpenAI, etc.) into a **canonical message format** (`CanonicalMessage`, `CanonicalToolCall`, etc.). All provider differences are isolated here.
- **`router/`** — Smart model routing (`RouterRuntime`). Classifies task difficulty and routes to appropriate model tiers (simple/medium/complex/reasoning). Supports fallback chains, zero-usage retry, auto-orchestration (spawning subagents for complex tasks), and token-saver judge prompts.
- **`tool/`** — Tool registry and built-in tools. Includes: `bash`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`, `web_fetch`, `web_search`, `ask_user_question`, `agent` (subagent fork), `task_create/list/output/stop`, `todo_write`, `enter_plan_mode`/`exit_plan_mode`, MCP tool bridge, and structured output. `ToolRuntime` executes tools with permission checks.
- **`session/`** — Session persistence. Sessions are stored per-project with JSONL transcripts, metadata, file history (backups), and git worktree support. `AgentProjectSessionStorage` handles the on-disk layout.
- **`extension/`** — Plugin architecture. `PluginRuntime` discovers, loads, and hot-reloads plugins. Plugins contribute hooks, commands, tools, prompts, MCP servers, and permission rules. Supports lifecycle hooks (`PreToolUse`, `UserPromptSubmit`, etc.) via `HookRuntime`. Built-in plugins live in `src/extension/plugins/builtin/`.
- **`adapters/`** — Channel adapters that connect the gateway to user-facing interfaces: CLI, TUI (Ink/React terminal UI), Web (HTTP/WS), and 15+ IM platforms (Feishu, WeChat, QQ, Telegram, Discord, Slack, Matrix, Mattermost, Signal, WhatsApp, BlueBubbles, DingTalk, WeCom, Email, SMS, HomeAssistant, Webhook, API Server).
- **`always-on/`** — Background execution system. The agent discovers candidate tasks, runs long-horizon monitors, and lands deliverables as local files. Uses discovery plans, work cycles, and workspace providers (git worktree or snapshot copy).
- **`cron/`** — Scheduled task system integrated with the gateway.
- **`mcp/`** — Model Context Protocol client integration. `McpClient` connects to MCP servers; `McpRuntime` bridges MCP tools/resources into OPC Brain's tool system.
- **`permission/`** — Permission system for tool execution with configurable rules and modes.
- **`pilot/`** — Configuration management. Reads `~/.pilotdeck/pilotdeck.yaml` with support for multiple config sources and hot-reload.

### Data Flow

A typical user interaction flows as follows:

1. **Channel** (e.g., Web UI, CLI, Feishu bot) receives user input and submits it to the **Gateway**.
2. **Gateway** routes to the appropriate **AgentSession** (creating one if needed).
3. **AgentSession** prepares the turn: loads context, applies memory retrieval, assembles the prompt via `PromptAssembler`.
4. **Router** classifies the task and selects the model/provider.
5. **Model** layer streams the request to the LLM provider.
6. **AgentLoop** receives model events, assembles the assistant message, collects tool calls.
7. **ToolRuntime** executes tools (with permission checks and lifecycle hooks). Some tools run concurrently (`bash`, `read_file`), others sequentially.
8. Tool results flow back to the model; the loop continues until the model finishes.
9. **Context** layer handles token budget, compaction, and memory capture.
10. **Session** writes the transcript to JSONL.

### UI Architecture

The Web UI (`ui/`) is a separate package with its own build. Key architectural pieces:

- **`AppShellV2`** (`ui/src/components/app-shell/AppShellV2.tsx`) — Root shell managing global layout, routing, tab state, project/session selection, and the WebSocket connection. The `AppShellContext` provides shared state to child components.
- **Tabs** — The main content area is tab-driven: `home` (dashboard), `chat`, `files`, `skills`, `dashboard`, `memory`, `always-on`, plus dynamic plugin tabs. Tab state is managed inside `AppShellV2` and persisted.
- **`MainContent`** (`ui/src/components/main-content/view/MainContent.tsx`) — Renders the active tab's content. The `HomeConsoleV2` is rendered when `activeTab === 'home'` and no project is selected.
- **Contexts** — React contexts in `ui/src/contexts/` provide: auth (`AuthContext.jsx`), WebSocket (`WebSocketContext.tsx`), theme (`ThemeContext.jsx`), plugins (`PluginsContext.tsx`), and tasks (`TaskMasterContext.ts`).
- **Hooks** — Custom hooks in `ui/src/hooks/` manage: project state (`useProjectsState.ts`), routing dashboard (`useRoutingDashboard.ts`), home dashboard (`useHomeDashboardData.ts`), session stats (`useCCRSessionStats.ts`), and tab navigation (`useAppTabs.ts`).
- **Types** — Shared UI types live in `ui/src/types/app.ts` (`AppTab`, `AlwaysOnDashboardEvent`, etc.).
- **i18n** — The UI uses `react-i18next` with translation files in `ui/src/locales/` (zh-CN, en). New UI strings should use `t('key')` and add entries to both locale files.
- **Theme** — Dark mode is the default for new visitors (`ThemeContext.jsx` defaults to `'dark'`). Components should support both light and dark via Tailwind's `dark:` prefix. The `ui-demo.html` at repo root is the design reference for the home dashboard.
- **Server bridge** — The UI has its own Express server (`ui/server/`) that serves the Vite-built assets and proxies API calls to the OPC Brain gateway.

### Key Architectural Decisions

- **Canonical message format**: All internal code uses `CanonicalMessage` / `CanonicalToolCall` / `CanonicalToolResult`. Provider-specific formats are only at the `model/` boundary.
- **WorkSpace isolation**: Every project gets its own file system, memory store, skill set, and session storage. Sessions are scoped to a project root.
- **Context compaction hierarchy**: `SnipEngine` (elide old turns) → `MicroCompactionEngine` (compress tool results) → `CompactionEngine` (full summarization). Triggered by token budget thresholds.
- **Subagent depth limit**: The `agent` tool forks a new `AgentLoop` with `depth + 1`; default max depth is 1 to prevent runaway recursion.
- **Plugin reload policy**: Plugins are discovered at startup and can be hot-reloaded. The `PluginReloadPolicy` controls whether reload is allowed.
- **EdgeClaw memory core**: A separate sub-package (`src/context/memory/edgeclaw-memory-core/`) with its own build step. It provides SQLite-backed memory storage with pipeline-based capture, retrieval, and review (dream mode).

### Project Structure

```
src/
  gateway/       # Session routing, in-process gateway
  agent/         # Agent loop, sessions, turns, subagents
  context/       # Prompt assembly, compaction, memory, token budgets
  model/         # Provider adapters, canonical format, streaming
  router/        # Smart routing, fallback, orchestration
  tool/          # Built-in tools, tool runtime, registry, scheduler
  session/       # Transcript storage, metadata, worktree, file history
  extension/     # Plugin system, hooks, commands, skills, MCP
  adapters/      # Channel adapters (CLI, TUI, Web, IM platforms)
  always-on/     # Background execution, discovery, work cycles
  cron/          # Scheduled tasks
  mcp/           # MCP client and runtime
  permission/    # Permission rules and decisions
  pilot/         # Config loading and paths
  cli/           # CLI entry point (pilotdeck.ts)
  web/           # Web server components

ui/              # React Web UI (separate package, Vite + Express server)
  src/
    components/     # React components (app-shell, chat, chat-v2, main-content, main-content-v2, etc.)
    contexts/       # React contexts (Auth, WebSocket, Theme, Plugins, etc.)
    hooks/          # Custom React hooks
    pages/          # Page-level components
    types/          # Shared TypeScript types (app.ts)
    locales/        # i18n translation files
    utils/          # Utility functions and API layer
skills/          # Bundled skills (SKILL.md files)
scripts/         # Dev launcher, bootstrap config, TUI E2E scripts
```

### Configuration

OPC Brain reads configuration from `~/.pilotdeck/pilotdeck.yaml`. On first run, `scripts/bootstrap-pilotdeck-config.mjs` generates a placeholder config with a sentinel API key that triggers the Web UI onboarding flow. The config supports:

- `agent.model` — Default model for the main agent
- `model.providers` — Provider definitions (OpenAI, Anthropic, DeepSeek, etc.)
- `router` — Smart routing configuration with tiers, fallback chains, auto-orchestration
- `alwaysOn` — Background execution settings
- `cron` — Scheduled tasks
- `adapters` — Channel adapter configurations
- `extensions` — Plugin and skill paths
- `webui.runtime` — UI server port and Vite dev port overrides

### Important Notes

- The root `package.json` uses React 19, while `ui/package.json` uses React 18. The `vitest.config.js` at root aliases React to the UI's node_modules to avoid test conflicts.
- `edgeclaw-memory-core` is a local file dependency that must be built before the main build.
- Builtin plugins in `src/extension/plugins/builtin/` are copied to `dist/` during build (they are not compiled by tsc).
- The dev launcher sets `PILOTDECK_SKIP_DEFAULT_PROJECT=1` to avoid auto-creating a default project in dev mode.
- The UI Express server proxies to the gateway via WebSocket. When running `npm run dev`, three processes start: gateway (OPC Brain backend), UI server (Express), and Vite (HMR client).
