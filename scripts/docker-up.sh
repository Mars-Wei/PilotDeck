#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "[opcbrain-docker] Created .env from .env.example."
  echo "[opcbrain-docker] Optional: edit .env and set PILOTDECK_API_KEY now."
  echo "[opcbrain-docker] If you keep the placeholder, finish model setup in the Web UI."
  echo "[opcbrain-docker] Rerun this script to start."
  exit 0
fi

read_env_value() {
  local key="$1"
  local value
  value="$(grep -E "^${key}=" .env | tail -n 1 | cut -d= -f2- || true)"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

WORKSPACE_DIR="$(read_env_value PILOTDECK_WORKSPACE)"
WORKSPACE_DIR="${WORKSPACE_DIR:-./workspace}"
mkdir -p "$WORKSPACE_DIR"

WEB_PORT="$(read_env_value PILOTDECK_WEB_PORT)"
WEB_PORT="${WEB_PORT:-3001}"

docker compose up -d --build

echo
echo "[opcbrain-docker] Started."
echo "[opcbrain-docker] Open: http://localhost:${WEB_PORT}"
echo "[opcbrain-docker] Logs: docker compose logs -f opcbrain"
