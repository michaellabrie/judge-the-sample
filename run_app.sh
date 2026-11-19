#!/usr/bin/env bash
# Start the Judge the Sample app on this computer. Stop it with Ctrl+C.
#
#   bash run_app.sh

set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Error: Node.js 20 or newer (with npm) is needed. Install it from https://nodejs.org and try again." >&2
  exit 1
fi
major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 20 ]; then
  echo "Error: Node.js $(node -v) is too old; this app needs Node.js 20 or newer." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run: installing the pinned packages (npm install)..."
  npm install
fi

echo "Starting Judge the Sample. Open http://localhost:5173/ (or the address Vite prints below)."
echo "Stop it with Ctrl+C."
exec npm run dev
