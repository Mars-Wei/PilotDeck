#!/usr/bin/env bash
set -euo pipefail

PILOT_HOME="${PILOT_HOME:-/root/.pilotdeck}"
CONFIG_FILE="$PILOT_HOME/pilotdeck.yaml"
SERVER_PORT="${SERVER_PORT:-3001}"
PILOTDECK_GATEWAY_PORT="${PILOTDECK_GATEWAY_PORT:-18789}"
PILOTDECK_GATEWAY_URL="${PILOTDECK_GATEWAY_URL:-ws://127.0.0.1:${PILOTDECK_GATEWAY_PORT}/ws}"
PILOTDECK_WORKSPACE_ROOT="${PILOTDECK_WORKSPACE_ROOT:-/workspace}"

export PILOT_HOME SERVER_PORT PILOTDECK_GATEWAY_PORT PILOTDECK_GATEWAY_URL PILOTDECK_WORKSPACE_ROOT

mkdir -p \
  "$PILOT_HOME/projects" \
  "$PILOT_HOME/router" \
  "$PILOT_HOME/skills" \
  "$PILOT_HOME/plugins" \
  "$PILOT_HOME/memory" \
  "$PILOTDECK_WORKSPACE_ROOT"

if [ -d "$CONFIG_FILE" ]; then
  echo "[opcbrain-docker] ERROR: $CONFIG_FILE is a directory, not a config file." >&2
  echo "[opcbrain-docker] If you intended to mount a YAML config, create the host file first or remove the bind mount and use PILOTDECK_* env vars." >&2
  exit 1
fi

# ── Generate config from env vars if no config file is mounted ────────
if [ ! -f "$CONFIG_FILE" ]; then
  MODEL="${PILOTDECK_MODEL:-openrouter/deepseek/deepseek-v4-flash}"
  LIGHT_MODEL="${PILOTDECK_LIGHT_MODEL:-openrouter/qwen/qwen3-8b}"
  API_KEY="${PILOTDECK_API_KEY:-PLACEHOLDER_RUN_ONBOARDING_TO_REPLACE}"
  API_URL="${PILOTDECK_API_URL:-https://openrouter.ai/api/v1}"

  # Derive provider name from model string (e.g. "openrouter/deepseek/deepseek-v4-flash" -> "openrouter")
  PROVIDER="${MODEL%%/*}"
  LIGHT_PROVIDER="${LIGHT_MODEL%%/*}"
  # Model ID is everything after the first slash
  MODEL_ID="${MODEL#*/}"
  LIGHT_MODEL_ID="${LIGHT_MODEL#*/}"

  if [ "$MODEL_ID" = "$LIGHT_MODEL_ID" ]; then
    SAME_PROVIDER_MODELS="        ${MODEL_ID}:
          capabilities:
            maxOutputTokens: 32768"
  else
    SAME_PROVIDER_MODELS="        ${MODEL_ID}:
          capabilities:
            maxOutputTokens: 32768
        ${LIGHT_MODEL_ID}:
          capabilities:
            maxOutputTokens: 16384"
  fi

  # Router section shared by both same-provider and cross-provider branches
  ROUTER_SECTION="router:
  enabled: true
  scenarios:
    default: ${MODEL}
  fallback:
    default:
      - ${MODEL}
  zeroUsageRetry:
    enabled: true
    maxAttempts: 2
  tokenSaver:
    enabled: true
    judge: ${LIGHT_MODEL}
    defaultTier: medium
    judgeTimeoutMs: 15000
    tiers:
      simple:
        model: ${LIGHT_MODEL}
        description: \"Simple greetings, confirmations, single-step Q&A, trivial file writes, remembering rules\"
      medium:
        model: ${LIGHT_MODEL}
        description: \"Single tool call, short text generation, 1-2 file read/write, code generation\"
      complex:
        model: ${MODEL}
        description: \"Needs sub-agent orchestration: parallel workstreams, delegation to specialized agents\"
      reasoning:
        model: ${MODEL}
        description: \"Deep single-agent work: multi-file operations, data analysis, multi-step workflows, web research, structured reports from many sources\"
    rules:
      - \"complex is ONLY for tasks that need sub-agent orchestration or parallel delegation — do NOT use it for single-agent multi-step work\"
      - \"Multi-file operations, data analysis, and multi-step workflows without orchestration should be reasoning\"
      - \"Simple file creation (1-2 files) or single code generation is medium\"
      - \"Trivial greetings, confirmations, remembering rules, or reading one file and answering a short question is simple\"
  autoOrchestrate:
    enabled: true
    triggerTiers:
      - complex
    slimSystemPrompt: true
    allowedTools:
      - agent
      - read_file
      - grep
      - glob
      - read_skill
    subagentMaxTokens: 48000
  stats:
    enabled: true"

  if [ "$PROVIDER" = "$LIGHT_PROVIDER" ]; then
    # Same provider for both models
    cat > "$CONFIG_FILE" <<YAML
schemaVersion: 1
agent:
  model: ${MODEL}
model:
  providers:
    ${PROVIDER}:
      protocol: openai
      url: ${API_URL}
      apiKey: ${API_KEY}
      models:
${SAME_PROVIDER_MODELS}
cron:
  enabled: true
  timezone: Asia/Shanghai
${ROUTER_SECTION}
YAML
  else
    # Different providers — declare both
    LIGHT_API_URL="${PILOTDECK_LIGHT_API_URL:-${API_URL}}"
    LIGHT_API_KEY="${PILOTDECK_LIGHT_API_KEY:-${API_KEY}}"
    cat > "$CONFIG_FILE" <<YAML
schemaVersion: 1
agent:
  model: ${MODEL}
model:
  providers:
    ${PROVIDER}:
      protocol: openai
      url: ${API_URL}
      apiKey: ${API_KEY}
      models:
        ${MODEL_ID}:
          capabilities:
            maxOutputTokens: 32768
    ${LIGHT_PROVIDER}:
      protocol: openai
      url: ${LIGHT_API_URL}
      apiKey: ${LIGHT_API_KEY}
      models:
        ${LIGHT_MODEL_ID}:
          capabilities:
            maxOutputTokens: 16384
cron:
  enabled: true
  timezone: Asia/Shanghai
${ROUTER_SECTION}
YAML
  fi

  echo "[opcbrain-docker] Generated config at $CONFIG_FILE (provider=$PROVIDER, model=$MODEL, light=$LIGHT_MODEL)"
fi

# ── Forward proxy env vars ────────────────────────────────────────────
if [ -n "${PILOTDECK_PROXY:-}" ]; then
  export http_proxy="$PILOTDECK_PROXY"
  export https_proxy="$PILOTDECK_PROXY"
  export HTTP_PROXY="$PILOTDECK_PROXY"
  export HTTPS_PROXY="$PILOTDECK_PROXY"
  echo "[opcbrain-docker] Proxy set to $PILOTDECK_PROXY"
fi

echo "[opcbrain-docker] Starting OPC Brain (gateway + UI server)..."
echo "[opcbrain-docker] Config: $CONFIG_FILE"
echo "[opcbrain-docker] Pilot home: $PILOT_HOME"
echo "[opcbrain-docker] Workspace root: $PILOTDECK_WORKSPACE_ROOT"
echo "[opcbrain-docker] Gateway URL: $PILOTDECK_GATEWAY_URL"
echo "[opcbrain-docker] UI will be available inside container at http://0.0.0.0:$SERVER_PORT"

# ── Start gateway + UI server via concurrently ────────────────────────
cd /app

exec concurrently --kill-others --names gateway,server \
  "node dist/src/cli/pilotdeck.js server --port ${PILOTDECK_GATEWAY_PORT}" \
  "node --import tsx ui/server/index.js"
