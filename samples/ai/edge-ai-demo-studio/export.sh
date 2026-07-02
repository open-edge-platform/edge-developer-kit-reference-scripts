#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN_DIR="$SCRIPT_DIR/thirdparty/node/bin"
NODE_PATH="$NODE_BIN_DIR/node"
SETUP_THIRDPARTY="$SCRIPT_DIR/scripts/bash/setup_thirdparty.sh"

# Install bundled Node.js if not already present
if [ ! -f "$NODE_PATH" ]; then
    echo "Bundled Node.js not found. Running thirdparty setup..."
    if [ ! -f "$SETUP_THIRDPARTY" ]; then
        echo "ERROR: Setup script not found at $SETUP_THIRDPARTY" >&2
        exit 1
    fi
    bash "$SETUP_THIRDPARTY"
fi

export PATH="$NODE_BIN_DIR:$PATH"

if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: node is not available after setup." >&2
    exit 1
fi

EXPORT_SCRIPT="$SCRIPT_DIR/scripts/export-samples.mjs"

# If arguments were passed, forward them directly (non-interactive mode).
if [ "$#" -gt 0 ]; then
    exec node "$EXPORT_SCRIPT" "$@"
fi

# ── Interactive mode ──────────────────────────────────────────────
echo "Discovering available samples..."
SAMPLES=()
while IFS= read -r line; do
    SAMPLES+=("$line")
done < <(node "$EXPORT_SCRIPT" --list | sed -n 's/^  - //p')

if [ "${#SAMPLES[@]}" -eq 0 ]; then
    echo "ERROR: No samples found." >&2
    exit 1
fi

echo ""
echo "Available samples:"
for i in "${!SAMPLES[@]}"; do
    printf "  %2d) %s\n" "$((i + 1))" "${SAMPLES[$i]}"
done

echo ""
read -r -p "Enter sample number(s) to export (space/comma separated): " selection
selection="${selection//,/ }"

CHOSEN=()
for n in $selection; do
    if ! [[ "$n" =~ ^[0-9]+$ ]] || [ "$n" -lt 1 ] || [ "$n" -gt "${#SAMPLES[@]}" ]; then
        echo "ERROR: Invalid selection '$n'." >&2
        exit 1
    fi
    CHOSEN+=("${SAMPLES[$((n - 1))]}")
done

if [ "${#CHOSEN[@]}" -eq 0 ]; then
    echo "ERROR: No samples selected." >&2
    exit 1
fi

ARGS=("--samples=$(IFS=,; echo "${CHOSEN[*]}")")

read -r -p "Include optional service dependencies? [Y/n]: " opt
case "$opt" in n|N) ARGS+=("--no-optional") ;; esac

read -r -p "Output directory (blank for default): " outdir
[ -n "$outdir" ] && ARGS+=("--out=$outdir")

read -r -p "Dry run (preview plan only)? [y/N]: " dry
case "$dry" in y|Y) ARGS+=("--dry-run") ;; esac

echo ""
echo "Running: export-samples ${ARGS[*]}"
exec node "$EXPORT_SCRIPT" "${ARGS[@]}"
