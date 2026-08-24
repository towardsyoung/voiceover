#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR=$(ls -d "$ROOT"/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 2>/dev/null | head -1)
if [[ -z "${DIR:-}" ]]; then
  echo "better-sqlite3 not installed; run pnpm install first"
  exit 1
fi
cd "$DIR"
npm run install
echo "better-sqlite3 rebuilt"
