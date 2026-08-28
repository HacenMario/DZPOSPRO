#!/usr/bin/env bash
# DZ POS PRO — Unix (Linux/macOS) launcher
# Starts the backend server and opens the app in the browser.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"

if [ ! -d "$BACKEND_DIR" ]; then
  echo "Backend folder not found at: $BACKEND_DIR" >&2
  exit 1
fi

cd "$BACKEND_DIR"

# Read PORT from .env (default 3001)
PORT="3001"
if [ -f .env ]; then
  PORT=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || echo "3001")
  PORT="${PORT:-3001}"
fi

# Install deps if missing
if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)..."
  npm install
fi

echo "Starting DZ POS PRO on http://localhost:$PORT ..."
npm run dev &
SERVER_PID=$!

# Wait for the server
sleep 4

# Open browser (best effort)
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:$PORT" >/dev/null 2>&1 || true
elif command -v open >/dev/null 2>&1; then
  open "http://localhost:$PORT" >/dev/null 2>&1 || true
fi

echo "Server PID: $SERVER_PID"
echo "Press Ctrl+C to stop."
wait $SERVER_PID
