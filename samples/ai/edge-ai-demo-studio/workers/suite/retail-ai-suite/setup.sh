#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

# ── Skip if already cloned ────────────────────────────────────────
if [ -f "$SRC_DIR/Makefile" ]; then
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

# ── Step 1: Resolve the pinned submodule commit from edge-ai-suites ──
# The retail-ai-suite/loss-prevention directory is a git submodule in
# edge-ai-suites. We sparse-clone edge-ai-suites at the requested ref to read
# the pinned commit hash via `git ls-tree`, then clone loss-prevention at that
# exact commit — guaranteeing the version that matches EDGE_AI_SUITES_REF.
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

# ── Step 2: Clone sample repo at the pinned commit ────────────────
log "Cloning $SAMPLE_REPO_URL at commit $LP_COMMIT"
git clone \
  --filter=blob:none \
  "$SAMPLE_REPO_URL" \
  "$TEMP_DIR/loss-prevention"

git -C "$TEMP_DIR/loss-prevention" checkout "$LP_COMMIT"

# ── Step 3: Initialise performance-tools submodule ────────────────
log "Initialising performance-tools submodule inside loss-prevention"
(cd "$TEMP_DIR/loss-prevention" && git submodule update --init --recursive)

# ── Step 4: Copy to src/ ──────────────────────────────────────────
mkdir -p "$SRC_DIR"
cp -r "$TEMP_DIR/loss-prevention/." "$SRC_DIR/"
printf '%s\n' "$REPO_REF" > "$REF_FILE"

log "Setup complete: $SRC_DIR (edge-ai-suites ref=$REPO_REF, loss-prevention commit=$LP_COMMIT)"
