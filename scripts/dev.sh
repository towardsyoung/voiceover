#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "created .env from .env.example"
fi

export API_HOST="${API_HOST:-127.0.0.1}"
export API_PORT="${API_PORT:-18787}"
export DATA_DIR="${DATA_DIR:-$ROOT/data}"

cleanup() {
  if [[ -n "${API_PID:-}" ]]; then kill "$API_PID" 2>/dev/null || true; fi
  if [[ -n "${WEB_PID:-}" ]]; then kill "$WEB_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

pnpm_config_verify_deps_before_run=false pnpm --filter @voiceover/api dev &
API_PID=$!
pnpm_config_verify_deps_before_run=false pnpm --filter @voiceover/web dev &
WEB_PID=$!

echo "API  http://${API_HOST}:${API_PORT}"
echo "Web  http://127.0.0.1:5173"
wait
