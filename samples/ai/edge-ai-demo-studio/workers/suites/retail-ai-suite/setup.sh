#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

EDGE_AI_SUITES_REPO_URL="${EDGE_AI_SUITES_REPO_URL:-https://github.com/open-edge-platform/edge-ai-suites.git}"
DEFAULT_REPO_REF="${EDGE_AI_SUITES_DEFAULT_REF:-main}"

log() { echo "[retail-ai-suite/setup] $*"; }

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

APP_ENV_KEY="EDGE_AI_SUITES_$(normalize_env_key "$APP_NAME")_REF"
APP_ENV_REF="${!APP_ENV_KEY:-}"
CONFIG_REF="$(read_config_var "$APP_CONFIG" EDGE_AI_SUITES_REF)"
REPO_REF="${APP_ENV_REF:-${EDGE_AI_SUITES_REF:-${EDGE_AI_SUITES_BRANCH:-${CONFIG_REF:-$DEFAULT_REPO_REF}}}}"

# Read required per-app config from suite.env
SAMPLE_REPO_URL="$(read_config_var "$APP_CONFIG" SAMPLE_REPO_URL)"
if [ -z "$SAMPLE_REPO_URL" ]; then
  log "ERROR: SAMPLE_REPO_URL is not set in $APP_CONFIG"
  exit 1
fi

SAMPLE_SUBMODULE_PATH="$(read_config_var "$APP_CONFIG" SAMPLE_SUBMODULE_PATH)"
if [ -z "$SAMPLE_SUBMODULE_PATH" ]; then
  log "ERROR: SAMPLE_SUBMODULE_PATH is not set in $APP_CONFIG"
  exit 1
fi

# Reuse the clone, or replace one from another ref
if [ -f "$SRC_DIR/Makefile" ]; then
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
  # Its volumes go too: a new release's images may not be able to use them (e.g. a non-root MinIO
  # can't write data a root one left).
  docker compose -f "$SRC_DIR/src/docker-compose.yml" down -v >/dev/null 2>&1 || true
  if ! rm -rf "$SRC_DIR"; then
    log "ERROR: could not remove $SRC_DIR — run: sudo rm -rf $SRC_DIR"
    exit 1
  fi
fi

# Step 1: resolve the pinned submodule commit
# The sample is a submodule of edge-ai-suites: read its commit at REPO_REF with `git ls-tree`, then
# clone the sample at exactly that commit.
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

SUBMODULE_PATH="$SAMPLE_SUBMODULE_PATH"

log "Sparse-cloning $EDGE_AI_SUITES_REPO_URL at ref '$REPO_REF' to resolve submodule commit"
git clone \
  --filter=blob:none \
  --sparse \
  --no-checkout \
  --branch "$REPO_REF" \
  "$EDGE_AI_SUITES_REPO_URL" \
  "$TEMP_DIR/edge-ai-suites"

# Read the pinned submodule commit hash. `git ls-tree` for a commit object
# outputs: <mode> commit <hash>\t<path>
LP_COMMIT="$(git -C "$TEMP_DIR/edge-ai-suites" ls-tree HEAD "$SUBMODULE_PATH" \
  | awk '/^[0-9]+ commit / { print $3 }')"

if [ -z "$LP_COMMIT" ]; then
  log "ERROR: Could not resolve submodule commit for '$SUBMODULE_PATH' in" \
      "$EDGE_AI_SUITES_REPO_URL at ref '$REPO_REF'."
  log "Verify that '$SUBMODULE_PATH' exists as a submodule at that ref."
  exit 1
fi

log "Resolved $APP_NAME commit: $LP_COMMIT"

# Step 2: clone the sample repo at the pinned commit
log "Cloning $SAMPLE_REPO_URL at commit $LP_COMMIT"
git clone \
  --filter=blob:none \
  "$SAMPLE_REPO_URL" \
  "$TEMP_DIR/loss-prevention"

git -C "$TEMP_DIR/loss-prevention" checkout "$LP_COMMIT"

# Step 3: initialise the performance-tools submodule
log "Initialising performance-tools submodule inside loss-prevention"
(cd "$TEMP_DIR/loss-prevention" && git submodule update --init --recursive)

# Step 4: copy to src/
mkdir -p "$SRC_DIR"
cp -r "$TEMP_DIR/loss-prevention/." "$SRC_DIR/"
printf '%s\n' "$REPO_REF" > "$REF_FILE"

log "Setup complete: $SRC_DIR (edge-ai-suites ref=$REPO_REF, loss-prevention commit=$LP_COMMIT)"
