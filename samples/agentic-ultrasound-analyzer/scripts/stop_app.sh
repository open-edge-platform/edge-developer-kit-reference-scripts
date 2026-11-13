#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -u

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd -- "$ROOT_DIR" || exit 1
BACKEND_SERVER_PORT="${BACKEND_SERVER_PORT:-15000}"
BLIP_SERVICE_PORT="${BLIP_SERVICE_PORT:-15100}"
MODE="${1:---shutdown}"

if [[ $# -gt 1 ]] || [[ "$MODE" != --shutdown && "$MODE" != --stale && "$MODE" != --status ]]; then
    echo "Usage: bash stop_app.sh [--shutdown|--stale|--status]" >&2
    exit 2
fi

is_app_process() {
    local comm="$1"
    local command_line="$2"
    [[ "$command_line" == *flask_backend_server.py* ||
        "$command_line" == *blip_service.py* ||
        "$command_line" == *ovms.exe* ||
        "$comm" == ovms ||
        "$command_line" =~ (^|[[:space:]])ovms([[:space:]]|$) ]]
}

get_app_processes() {
    local pid comm command_line
    while read -r pid comm command_line; do
        [[ "$pid" == "$$" ]] && continue
        if is_app_process "$comm" "$command_line"; then
            printf '%s\t%s\n' "$pid" "$command_line"
        fi
    done < <(ps -eo pid=,comm=,args=)
}

get_listener_pids() {
    local port
    if ! command -v ss >/dev/null 2>&1; then
        echo "[WARN] ss is not installed; unable to inspect TCP listeners." >&2
        return 0
    fi
    for port in "$BACKEND_SERVER_PORT" "$BLIP_SERVICE_PORT" 8000 9000; do
        ss -H -ltnp 2>/dev/null | awk -v port="$port" '
            $4 ~ (":" port "$") {
                line = $0
                while (match(line, /pid=[0-9]+/)) {
                    print port "\t" substr(line, RSTART + 4, RLENGTH - 4)
                    line = substr(line, RSTART + RLENGTH)
                }
            }
        '
    done
}

if [[ "$MODE" == --status ]]; then
    echo "============================================================"
    echo " Agentic Ultrasound Analyzer - Runtime Status"
    echo "============================================================"
    echo
    echo "App process candidates (backend/BLIP/OVMS):"
    app_processes="$(get_app_processes)"
    if [[ -n "$app_processes" ]]; then
        printf 'PID\tCOMMAND\n%s\n' "$app_processes"
    else
        echo "none"
    fi
    echo
    echo "Port listeners ($BACKEND_SERVER_PORT/$BLIP_SERVICE_PORT/8000/9000):"
    listeners="$(get_listener_pids | sort -u)"
    if [[ -n "$listeners" ]]; then
        printf 'PORT\tPID\n%s\n' "$listeners"
    else
        echo "none"
    fi
    echo
    echo "Milvus container status:"
    if command -v docker >/dev/null 2>&1; then
        docker ps --filter "name=milvus-standalone" --format 'table {{.Names}}\t{{.Status}}' ||
            echo "Unable to query Docker container status."
    else
        echo "Docker is not installed."
    fi
    echo
    echo "Status check complete."
    exit 0
fi

echo "============================================================"
echo " Agentic Ultrasound Analyzer - Process Guard ($MODE)"
echo "============================================================"

killed_processes=()
while IFS=$'\t' read -r pid command_line; do
    [[ -n "$pid" ]] || continue
    if kill -KILL "$pid" 2>/dev/null; then
        killed_processes+=("$pid")
    fi
done < <(get_app_processes)
if ((${#killed_processes[@]})); then
    printf 'Killed process IDs: %s\n' "$(printf '%s\n' "${killed_processes[@]}" | sort -nu | paste -sd ',' - | sed 's/,/, /g')"
else
    echo "Killed process IDs: none"
fi

killed_listeners=()
while IFS=$'\t' read -r port pid; do
    [[ -n "${pid:-}" ]] || continue
    if kill -KILL "$pid" 2>/dev/null; then
        killed_listeners+=("$pid")
    fi
done < <(get_listener_pids)
if ((${#killed_listeners[@]})); then
    printf 'Killed listener process IDs: %s\n' "$(printf '%s\n' "${killed_listeners[@]}" | sort -nu | paste -sd ',' - | sed 's/,/, /g')"
else
    echo "Killed listener process IDs: none"
fi

if [[ "$MODE" == --shutdown ]]; then
    echo "Stopping Milvus container..."
    if command -v docker >/dev/null 2>&1; then
        if docker container inspect milvus-standalone >/dev/null 2>&1; then
            if docker stop --time 10 milvus-standalone; then
                echo "Milvus stop requested."
            else
                echo "[WARN] Failed to stop Milvus; stop it manually." >&2
            fi
        else
            echo "[WARN] Milvus container not found. Skipping stop."
        fi
    else
        echo "[WARN] Docker is not installed. Skipping Milvus stop."
    fi
fi

echo "Process guard complete."