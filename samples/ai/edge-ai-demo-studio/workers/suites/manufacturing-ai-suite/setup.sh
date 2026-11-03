#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

REPO_URL="${EDGE_AI_SUITES_REPO_URL:-https://github.com/open-edge-platform/edge-ai-suites.git}"
DEFAULT_REPO_REF="${EDGE_AI_SUITES_DEFAULT_REF:-main}"

log() { echo "[manufacturing-ai-suite/setup] $*"; }

APP_NAME="${1:-}"
if [ -z "$APP_NAME" ]; then
  log "ERROR: missing argument. Usage: $0 <suite-app-folder>"
  exit 64
fi

APP_DIR="$SCRIPT_DIR/$APP_NAME"
SRC_DIR="$APP_DIR/src"
APP_CONFIG="$APP_DIR/suite.env"
REF_FILE="$SRC_DIR/.demo-studio-edge-ai-suites-ref"

normalize_env_key() {
  echo "$1" | tr '[:lower:]-' '[:upper:]_' | tr -cd '[:alnum:]_'
}

read_config_var() {
  local file="$1" key="$2" line
  [ -f "$file" ] || return 0

  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [ -n "$line" ] || continue
    if [[ "$line" == "$key="* ]]; then
      echo "${line#*=}"
      return 0
    fi
  done < "$file"
}

# The suite's apps share the industrial-edge-insights-vision template; SAMPLE_APP picks the sample.
APP_PATH_DEFAULT="manufacturing-ai-suite/industrial-edge-insights-vision"
CONFIG_APP_PATH="$(read_config_var "$APP_CONFIG" EDGE_AI_SUITES_APP_PATH)"
APP_PATH="${EDGE_AI_SUITES_APP_PATH:-${CONFIG_APP_PATH:-$APP_PATH_DEFAULT}}"

APP_ENV_KEY="EDGE_AI_SUITES_$(normalize_env_key "$APP_NAME")_REF"
APP_ENV_REF="${!APP_ENV_KEY:-}"
CONFIG_REF="$(read_config_var "$APP_CONFIG" EDGE_AI_SUITES_REF)"
REPO_REF="${APP_ENV_REF:-${EDGE_AI_SUITES_REF:-${EDGE_AI_SUITES_BRANCH:-${CONFIG_REF:-$DEFAULT_REPO_REF}}}}"

# Reuse the clone, or replace one from another ref
if [ -f "$SRC_DIR/docker-compose.yml" ]; then
  # A clone made before the ref was recorded is taken to be the configured one.
  [ -f "$REF_FILE" ] || printf '%s\n' "$REPO_REF" > "$REF_FILE"
  EXISTING_REF="$(cat "$REF_FILE")"
  if [ "$EXISTING_REF" = "$REPO_REF" ]; then
    log "$APP_NAME already set up at $SRC_DIR (edge-ai-suites ref=$REPO_REF)"
    exit 0
  fi

  # The configured ref changed (an update of this app): the old stack runs
  # from the old clone, so it is stopped with it before the clone goes.
  log "Replacing $APP_NAME's edge-ai-suites ref '$EXISTING_REF' with '$REPO_REF'"
  bash "$APP_DIR/stop.sh" || log "WARNING: could not stop the stack of ref '$EXISTING_REF'"
  # Its volumes go too: a new release's images may not be able to use them (e.g. data written by
  # a service that no longer runs as root).
  docker compose -f "$SRC_DIR/docker-compose.yml" down -v >/dev/null 2>&1 || true
  if ! rm -rf "$SRC_DIR"; then
    log "ERROR: could not remove $SRC_DIR — run: sudo rm -rf $SRC_DIR"
    exit 1
  fi
fi

# Sparse-clone the upstream template, then copy it to src/
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

log "Cloning $REPO_URL (sparse, ref=$REPO_REF, path=$APP_PATH)"
git clone \
  --filter=blob:none \
  --sparse \
  --branch "$REPO_REF" \
  "$REPO_URL" \
  "$TEMP_DIR"

cd "$TEMP_DIR"
git sparse-checkout add "$APP_PATH"

if [ ! -d "$TEMP_DIR/$APP_PATH" ]; then
  log "ERROR: $APP_PATH not found in repo after sparse-checkout." \
      "Verify EDGE_AI_SUITES_APP_PATH (default: $APP_PATH_DEFAULT) exists in $REPO_URL."
  exit 1
fi

mkdir -p "$SRC_DIR"
cp -r "$TEMP_DIR/$APP_PATH/." "$SRC_DIR/"
printf '%s\n' "$REPO_REF" > "$REF_FILE"

log "Setup complete: $SRC_DIR (edge-ai-suites ref=$REPO_REF, path=$APP_PATH)"
