#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
# Linux launcher: bash start_app.sh [--quick]. Stop with Ctrl+C.
# VENV_DIR defaults to ../venv. CPU_MODE and device overrides are inherited.
# Start the BLIP service separately, as with start_app.bat.
# Docker must already be running; otherwise start Milvus externally.
# Only the backend and Milvus container started here are stopped on exit.

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd -- "$ROOT_DIR"
QUICK_MODE=0
case "${1:-}" in
    "") ;;
    --quick) QUICK_MODE=1 ;;
    *) echo "[ERROR] Usage: bash start_app.sh [--quick]" >&2; exit 1 ;;
esac
[[ $# -le 1 ]] || { echo "[ERROR] Too many arguments." >&2; exit 1; }
[[ "$(uname -s)" == "Linux" ]] || { echo "[ERROR] This launcher supports Linux only." >&2; exit 1; }

export BACKEND_SERVER_PORT="${BACKEND_SERVER_PORT:-15000}"
export BLIP_SERVICE_PORT="${BLIP_SERVICE_PORT:-15100}"
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
export ASR_STREAMING_WARMUP="${ASR_STREAMING_WARMUP:-1}"
export ASR_PRECREATE_ON_STARTUP="${ASR_PRECREATE_ON_STARTUP:-1}"
export MILVUS_ENABLE_ON_STARTUP="${MILVUS_ENABLE_ON_STARTUP:-1}"
export BLIP_ENABLE_ON_STARTUP="${BLIP_ENABLE_ON_STARTUP:-1}"
export FETALCLIP_PRELOAD_ON_STARTUP="${FETALCLIP_PRELOAD_ON_STARTUP:-1}"
export FETALCLIP_DEVICE="${FETALCLIP_DEVICE:-NPU}"
export OVMS_LOCAL_FALLBACK="${OVMS_LOCAL_FALLBACK:-1}"
export REPORT_PRELOAD_ON_STARTUP="${REPORT_PRELOAD_ON_STARTUP:-1}"
export ULTRASOUND_PRELOAD_ON_STARTUP="${ULTRASOUND_PRELOAD_ON_STARTUP:-1}"
if [[ "$QUICK_MODE" == 1 ]]; then
    FLASK_STARTUP_TIMEOUT_SECONDS="${FLASK_STARTUP_TIMEOUT_SECONDS:-90}"
    MILVUS_HEALTH_MAX_ATTEMPTS="${MILVUS_HEALTH_MAX_ATTEMPTS:-25}"
else
    FLASK_STARTUP_TIMEOUT_SECONDS="${FLASK_STARTUP_TIMEOUT_SECONDS:-300}"
    MILVUS_HEALTH_MAX_ATTEMPTS="${MILVUS_HEALTH_MAX_ATTEMPTS:-120}"
fi
for name in BACKEND_SERVER_PORT BLIP_SERVICE_PORT FLASK_STARTUP_TIMEOUT_SECONDS MILVUS_HEALTH_MAX_ATTEMPTS; do
    value="${!name}"
    if [[ ! "$value" =~ ^[1-9][0-9]{0,5}$ ]]; then
        echo "[ERROR] $name must be a positive integer of at most six digits." >&2
        exit 1
    fi
done
if (( BACKEND_SERVER_PORT > 65535 || BLIP_SERVICE_PORT > 65535 )); then
    echo "[ERROR] Service ports must be between 1 and 65535." >&2
    exit 1
fi
for tool in curl flock; do
    command -v "$tool" > /dev/null || { echo "[ERROR] Required command not found: $tool" >&2; exit 1; }
done
VENV_DIR="${VENV_DIR:-$ROOT_DIR/../venv}"
PYTHON="$VENV_DIR/bin/python"
[[ -x "$PYTHON" ]] || { echo "[ERROR] No Linux virtual environment at $VENV_DIR. Run install_dependencies.sh first." >&2; exit 1; }
"$PYTHON" -c 'import flask, flask_cors' ||
    { echo "[ERROR] Backend dependencies are missing. Run install_dependencies.sh with this virtual environment." >&2; exit 1; }
mkdir -p -- "$ROOT_DIR/logs"
BACKEND_LOG="$ROOT_DIR/logs/flask_backend_startup.log"
# Keep the lock file: removing it can let launchers lock different inodes.
exec 9>"$ROOT_DIR/logs/start_app_linux.lock"
flock -n 9 || { echo "[ERROR] Another Linux launcher is already running." >&2; exit 1; }

BACKEND_PID=""
MILVUS_STARTED=0
cleanup() {
    local status=$?
    trap - EXIT INT TERM
    if [[ -n "$BACKEND_PID" ]]; then
        if kill -0 "$BACKEND_PID" 2>/dev/null; then
            echo "Stopping Flask backend (PID $BACKEND_PID)..."
            kill -TERM "$BACKEND_PID" || echo "[WARN] Unable to terminate backend PID $BACKEND_PID." >&2
            for ((i=0; i<10; i++)); do
                kill -0 "$BACKEND_PID" 2>/dev/null || break
                sleep 1
            done
            if kill -0 "$BACKEND_PID" 2>/dev/null; then
                kill -KILL "$BACKEND_PID" || echo "[WARN] Unable to kill backend PID $BACKEND_PID." >&2
            fi
        fi
        wait "$BACKEND_PID" 2>/dev/null || :
    fi
    if [[ "$MILVUS_STARTED" == 1 ]]; then
        docker stop --time 10 milvus-standalone 9>&- ||
            echo "[WARN] Failed to stop Milvus; stop it manually." >&2
    fi
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'echo "[ERROR] Launcher failed at line $LINENO." >&2' ERR

# Do not mistake an unrelated server for the backend we are about to launch.
if ! "$PYTHON" -c 'import socket, sys; s = socket.socket(); s.bind(("127.0.0.1", int(sys.argv[1]))); s.close()' "$BACKEND_SERVER_PORT"; then
    echo "[ERROR] Backend port $BACKEND_SERVER_PORT is unavailable; inspect the listener before stopping it." >&2
    bash "$ROOT_DIR/stop_app.sh" --status
    exit 1
fi

echo "[1/3] Checking Milvus..."
if ! command -v docker > /dev/null; then
    echo "[WARN] Docker is not installed. Start Milvus externally. Skipping container startup."
elif ! docker info > /dev/null 2>&1; then
    echo "[WARN] Docker is unavailable. Start the Docker daemon or Milvus externally. Skipping container startup."
else
    if docker container inspect milvus-standalone > /dev/null 2>&1; then
        running="$(docker inspect --format '{{.State.Running}}' milvus-standalone)"
        if [[ "$running" != true ]]; then
            docker start milvus-standalone
            MILVUS_STARTED=1
        fi
    else
        MILVUS_DIR="$ROOT_DIR/milvus"
        mkdir -p -- "$MILVUS_DIR/volumes/milvus"
        if [[ ! -f "$MILVUS_DIR/embedEtcd.yaml" ]]; then
            printf '%s\n' \
                'listen-client-urls: http://0.0.0.0:2379' \
                'advertise-client-urls: http://0.0.0.0:2379' \
                'quota-backend-bytes: 4294967296' \
                'auto-compaction-mode: revision' \
                "auto-compaction-retention: '1000'" > "$MILVUS_DIR/embedEtcd.yaml"
        fi
        if [[ ! -f "$MILVUS_DIR/user.yaml" ]]; then
            printf '%s\n' '# Extra config to override default milvus.yaml' > "$MILVUS_DIR/user.yaml"
        fi
        docker run -d --name milvus-standalone --security-opt seccomp:unconfined \
            -e ETCD_USE_EMBED=true -e ETCD_DATA_DIR=/var/lib/milvus/etcd \
            -e ETCD_CONFIG_PATH=/milvus/configs/embedEtcd.yaml \
            -e COMMON_STORAGETYPE=local -e DEPLOY_MODE=STANDALONE \
            -v "$MILVUS_DIR/volumes/milvus:/var/lib/milvus" \
            -v "$MILVUS_DIR/embedEtcd.yaml:/milvus/configs/embedEtcd.yaml" \
            -v "$MILVUS_DIR/user.yaml:/milvus/configs/user.yaml" \
            -p 127.0.0.1:19530:19530 -p 127.0.0.1:9091:9091 -p 127.0.0.1:2379:2379 \
            --health-cmd 'curl -f http://localhost:9091/healthz' \
            --health-interval 30s --health-start-period 90s --health-timeout 20s --health-retries 3 \
            milvusdb/milvus:v3.0.3 milvus run standalone
        MILVUS_STARTED=1
    fi
    healthy=0
    for ((attempt=0; attempt<MILVUS_HEALTH_MAX_ATTEMPTS; attempt++)); do
        if [[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' milvus-standalone)" == healthy ]]; then
            healthy=1
            break
        fi
        sleep 1
    done
    if [[ "$healthy" == 1 ]]; then
        echo "Milvus is healthy."
    else
        echo "[WARN] Milvus did not become healthy. Continuing startup."
    fi
fi

echo "[2/3] Starting Flask backend. Log: $BACKEND_LOG"
"$PYTHON" -X utf8 -u "$ROOT_DIR/flask_backend_server.py" > "$BACKEND_LOG" 2>&1 9>&- &
BACKEND_PID=$!
ready=0
deadline=$((SECONDS + FLASK_STARTUP_TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
        echo "[ERROR] Flask backend exited during startup." >&2
        tail -n 80 -- "$BACKEND_LOG" >&2
        exit 1
    fi
    if code="$(curl --noproxy 127.0.0.1 --connect-timeout 1 --max-time 2 -s -o /dev/null -w '%{http_code}' \
        "http://127.0.0.1:$BACKEND_SERVER_PORT/health")" && [[ "$code" == 200 ]]; then
        ready=1
        break
    fi
    sleep 1
done
if [[ "$ready" != 1 ]]; then
    echo "[ERROR] Flask health check timed out after $FLASK_STARTUP_TIMEOUT_SECONDS seconds." >&2
    tail -n 80 -- "$BACKEND_LOG" >&2
    exit 1
fi

URL="http://127.0.0.1:$BACKEND_SERVER_PORT/video_player_intent.html"
echo "[3/3] Frontend: $URL"
if [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]] && command -v xdg-open > /dev/null; then
    xdg-open "$URL" 9>&- || echo "[WARN] Could not open browser. Open $URL manually." >&2
else
    echo "Open this URL in your browser."
fi
echo "Application is running. Start the BLIP embedding service separately."
echo "Press Ctrl+C to stop the backend and any Milvus container started by this launcher."
if wait "$BACKEND_PID"; then
    BACKEND_PID=""
else
    status=$?
    echo "[ERROR] Flask backend exited with status $status. See $BACKEND_LOG." >&2
    tail -n 80 -- "$BACKEND_LOG" >&2
    exit "$status"
fi
