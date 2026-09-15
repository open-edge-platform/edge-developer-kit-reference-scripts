#!/usr/bin/env bash
# Detects whether a metrics-manager container is already running on this host
# under a *different* Compose project (e.g. uav-mission-compute-sdk, which also
# runs a container named "metrics-manager" bound to host port 9090). Both apps
# would otherwise collide on the container name and the published port.
#
# If an external, healthy metrics-manager is found, this app reuses it instead
# of starting its own bundled instance. Writes METRICS_MANAGER_URL and
# METRICS_MANAGER_SCALE into .env for `docker compose up` to pick up.
#
# Usage: scripts/detect_metrics_manager.sh
set -euo pipefail

MM_PORT="${METRICS_MANAGER_PORT:-9090}"
ENV_FILE="${ENV_FILE:-.env}"

# Ask compose itself for the normalized project name (respects .env
# COMPOSE_PROJECT_NAME / top-level `name:` / directory-name fallback) rather
# than reimplementing its normalization rules.
our_project=$(docker compose config 2>/dev/null | awk '/^name:/{print $2; exit}')

existing_project=""
if docker inspect metrics-manager >/dev/null 2>&1; then
  existing_project=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' metrics-manager 2>/dev/null || true)
fi

set_env() {
  bash "$(dirname "${BASH_SOURCE[0]}")/set_env.sh" "$1" "$2" "$ENV_FILE"
}

if [ -n "$existing_project" ] && [ "$existing_project" != "$our_project" ] \
   && curl -fsS --max-time 2 "http://localhost:${MM_PORT}/health" >/dev/null 2>&1; then
  echo "[metrics-manager] Found an existing, healthy metrics-manager (project: ${existing_project}) on port ${MM_PORT}."
  echo "[metrics-manager] Reusing it instead of starting a second instance — set METRICS_MANAGER_URL to point at it."
  set_env METRICS_MANAGER_URL "http://host.docker.internal:${MM_PORT}"
  set_env METRICS_MANAGER_SCALE 0
else
  echo "[metrics-manager] No external instance to reuse — this project will start its own on port ${MM_PORT}."
  set_env METRICS_MANAGER_URL "http://metrics-manager:${MM_PORT}"
  set_env METRICS_MANAGER_SCALE 1
fi
