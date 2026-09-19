#!/usr/bin/env bash
# Pull the latest Lister, rebuild, and restart the background server.
set -euo pipefail

cd "$(dirname "$0")"

git pull --ff-only
pnpm install --frozen-lockfile
pnpm build

LISTER="node $PWD/packages/cli/dist/main.js"
INFO="$HOME/.lister/server.json"

# stop the running server, if any
if [ -f "$INFO" ]; then
  PID=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('pid',''))" "$INFO" 2>/dev/null || true)
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    echo "stopping lister server (pid $PID)"
    kill "$PID"
    for _ in $(seq 1 30); do kill -0 "$PID" 2>/dev/null || break; sleep 0.1; done
  fi
  rm -f "$INFO"
fi

$LISTER serve --daemon
sleep 1
$LISTER status
