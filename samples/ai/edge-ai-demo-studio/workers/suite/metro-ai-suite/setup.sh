#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

REPO_URL="${EDGE_AI_SUITES_REPO_URL:-https://github.com/open-edge-platform/edge-ai-suites.git}"
DEFAULT_REPO_REF="${EDGE_AI_SUITES_DEFAULT_REF:-main}"

log() { echo "[metro-ai-suite/setup] $*"; }

APP_NAME="${1:-}"
if [ -z "$APP_NAME" ]; then
  log "ERROR: missing argument. Usage: $0 <suite-app-folder>"
  exit 64
fi

APP_DIR="$SCRIPT_DIR/$APP_NAME"
SRC_DIR="$APP_DIR/src"
APP_PATH="metro-ai-suite/$APP_NAME"
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

APP_ENV_KEY="EDGE_AI_SUITES_$(normalize_env_key "$APP_NAME")_REF"
APP_ENV_REF="${!APP_ENV_KEY:-}"
CONFIG_REF="$(read_config_var "$APP_CONFIG" EDGE_AI_SUITES_REF)"
REPO_REF="${APP_ENV_REF:-${EDGE_AI_SUITES_REF:-${EDGE_AI_SUITES_BRANCH:-${CONFIG_REF:-$DEFAULT_REPO_REF}}}}"

# ── Skip if already cloned ────────────────────────────────────────
if [ -f "$SRC_DIR/compose.yml" ]; then
  if [ -f "$REF_FILE" ]; then
    EXISTING_REF="$(cat "$REF_FILE")"
    if [ "$EXISTING_REF" != "$REPO_REF" ]; then
      log "ERROR: $APP_NAME is already set up from edge-ai-suites ref '$EXISTING_REF'," \
          "but configuration requests '$REPO_REF'."
      log "Remove $SRC_DIR to fetch the configured ref, or restore EDGE_AI_SUITES_REF=$EXISTING_REF."
      exit 1
    fi
  else
    printf '%s\n' "$REPO_REF" > "$REF_FILE"
  fi

  log "$APP_NAME already set up at $SRC_DIR (edge-ai-suites ref=$REPO_REF)"
  exit 0
fi

# ── Sparse-clone the specific app path, then copy to src/ ─────────
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
      "Verify the app name is correct (looking under metro-ai-suite/ in $REPO_URL)."
  exit 1
fi

mkdir -p "$SRC_DIR"
cp -r "$TEMP_DIR/$APP_PATH/." "$SRC_DIR/"
printf '%s\n' "$REPO_REF" > "$REF_FILE"

log "Setup complete: $SRC_DIR (edge-ai-suites ref=$REPO_REF)"
