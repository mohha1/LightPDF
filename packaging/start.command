#!/bin/sh
# Starts LightPDF with a local server on macOS: double-click this file.
cd "$(dirname "$0")" || exit 1
if command -v node >/dev/null 2>&1; then
  exec node server.mjs
elif command -v python3 >/dev/null 2>&1; then
  echo "Node.js not found, using Python. Open http://localhost:8080/ in your browser."
  echo "Press Ctrl+C to stop."
  (sleep 1; xdg-open http://localhost:8080/ >/dev/null 2>&1 || open http://localhost:8080/ >/dev/null 2>&1) &
  exec python3 -m http.server 8080 --bind 127.0.0.1 --directory app
else
  echo "LightPDF needs Node.js (https://nodejs.org) or Python 3 to run. Install one and try again."
  exit 1
fi
