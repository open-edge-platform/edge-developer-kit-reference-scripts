#!/usr/bin/env bash
set -uo pipefail

APP_ROOT="${HUMANOID_RL_HOME:-/app}"
BACKEND_DIR="$APP_ROOT/application/backend"
FRONTEND_DIR="$APP_ROOT/application/frontend"

cd "$APP_ROOT"
ONEAPI_SET_VARS="${ONEAPI_ROOT:-/opt/intel/oneapi}/setvars.sh"
if [[ -f "$ONEAPI_SET_VARS" ]]; then
    set +u
    source "$ONEAPI_SET_VARS" >/dev/null 2>&1
    set -u
fi

"$BACKEND_DIR/.venv/bin/python" -m uvicorn backend.main:app \
    --app-dir "$BACKEND_DIR/src" \
    --env-file "$APP_ROOT/application/.env" \
    --host "${BACKEND_HOST:-127.0.0.1}" \
    --port "${BACKEND_PORT:-8000}" &
BACKEND_PID=$!

(
    cd "$FRONTEND_DIR"
    HOSTNAME="${FRONTEND_HOST:-0.0.0.0}" PORT="${FRONTEND_PORT:-3000}" node server.js
) &
FRONTEND_PID=$!

shutdown() {
    kill -TERM "$FRONTEND_PID" "$BACKEND_PID" 2>/dev/null || true
    wait "$FRONTEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
}

trap shutdown TERM INT
wait -n "$BACKEND_PID" "$FRONTEND_PID"
STATUS=$?
shutdown
exit "$STATUS"