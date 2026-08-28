#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN_DIR="$SCRIPT_DIR/thirdparty/node/bin"
NODE_PATH="$NODE_BIN_DIR/node"
SETUP_THIRDPARTY="$SCRIPT_DIR/scripts/bash/setup_thirdparty.sh"
EXPORT_SCRIPT="$SCRIPT_DIR/scripts/export-bundle.mjs"

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

# --dry-run/--plan alone should still walk through the interactive prompts
# (just previewing the plan instead of writing files), so pull it out before
# deciding whether to forward everything non-interactively.
DRY_RUN_FLAG=""
REMAINING_ARGS=()
for a in "$@"; do
    if [ "$a" = "--dry-run" ] || [ "$a" = "--plan" ]; then
        DRY_RUN_FLAG="$a"
    else
        REMAINING_ARGS+=("$a")
    fi
done

# If other arguments were passed, forward everything directly (non-interactive mode).
if [ "${#REMAINING_ARGS[@]}" -gt 0 ]; then
    exec node "$EXPORT_SCRIPT" "$@"
fi

# ── Interactive mode ──────────────────────────────────────────────
echo ""
echo "Discovering available samples and services..."
# --list prints two sections ("Available samples:" / "Available services:"),
# each with "  - <id>" entries.
SAMPLES=()
SERVICES=()
section=""
while IFS= read -r line; do
    case "$line" in
        "Available samples:") section="samples"; continue ;;
        "Available services:") section="services"; continue ;;
    esac
    if [[ "$line" =~ ^[[:space:]]+-[[:space:]] ]]; then
        id="$(echo "${line#*- }" | xargs)"
        if [ "$section" = "services" ]; then
            SERVICES+=("$id")
        else
            SAMPLES+=("$id")
        fi
    fi
done < <(node "$EXPORT_SCRIPT" --list)

if [ "${#SAMPLES[@]}" -eq 0 ] && [ "${#SERVICES[@]}" -eq 0 ]; then
    echo "ERROR: No samples or services found." >&2
    exit 1
fi

echo ""
echo "Available samples:"
for i in "${!SAMPLES[@]}"; do
    printf "  %2d) %s\n" "$((i + 1))" "${SAMPLES[$i]}"
done

echo ""
echo "Available services:"
NUM_SAMPLES="${#SAMPLES[@]}"
for i in "${!SERVICES[@]}"; do
    printf "  %2d) %s\n" "$((NUM_SAMPLES + i + 1))" "${SERVICES[$i]}"
done

NUM_SERVICES="${#SERVICES[@]}"
TOTAL=$((NUM_SAMPLES + NUM_SERVICES))

# Resolve a space/comma-separated selection (numbers continue past the sample
# list into the service list, or literal ids) into CHOSEN_SAMPLES /
# CHOSEN_SERVICES. Exits with an error on any unmatched token.
resolve_selection() {
    local input="${1//,/ }"
    local tok item
    for tok in $input; do
        if [[ "$tok" =~ ^[0-9]+$ ]] && [ "$tok" -ge 1 ] && [ "$tok" -le "$TOTAL" ]; then
            if [ "$tok" -le "$NUM_SAMPLES" ]; then
                CHOSEN_SAMPLES+=("${SAMPLES[$((tok - 1))]}")
            else
                CHOSEN_SERVICES+=("${SERVICES[$((tok - 1 - NUM_SAMPLES))]}")
            fi
            continue
        fi
        for item in "${SAMPLES[@]}"; do
            if [ "$item" = "$tok" ]; then
                CHOSEN_SAMPLES+=("$item")
                continue 2
            fi
        done
        for item in "${SERVICES[@]}"; do
            if [ "$item" = "$tok" ]; then
                CHOSEN_SERVICES+=("$item")
                continue 2
            fi
        done
        echo "ERROR: Invalid selection '$tok'." >&2
        exit 1
    done
}

echo ""
read -r -p "Enter number(s) or name(s) to export (samples and/or services, space/comma separated, blank for none): " selection
CHOSEN_SAMPLES=()
CHOSEN_SERVICES=()
resolve_selection "$selection"

# Drop duplicates (e.g. the same service picked once by number, once by name).
dedup() {
    local -n _arr="$1"
    local -A seen=()
    local out=() x
    for x in "${_arr[@]}"; do
        if [ -z "${seen[$x]:-}" ]; then
            seen[$x]=1
            out+=("$x")
        fi
    done
    _arr=("${out[@]}")
}
dedup CHOSEN_SAMPLES
dedup CHOSEN_SERVICES

if [ "${#CHOSEN_SAMPLES[@]}" -eq 0 ] && [ "${#CHOSEN_SERVICES[@]}" -eq 0 ]; then
    echo "ERROR: Nothing selected - pick at least one sample or service." >&2
    exit 1
fi

ARGS=()
if [ "${#CHOSEN_SAMPLES[@]}" -gt 0 ]; then
    ARGS+=("--samples=$(IFS=,; echo "${CHOSEN_SAMPLES[*]}")")
fi
if [ "${#CHOSEN_SERVICES[@]}" -gt 0 ]; then
    ARGS+=("--services=$(IFS=,; echo "${CHOSEN_SERVICES[*]}")")
fi

# Optional deps only come from selected samples; skip if none were chosen.
if [ "${#CHOSEN_SAMPLES[@]}" -gt 0 ]; then
    read -r -p "Include optional service dependencies? [Y/n]: " opt
    case "$opt" in n|N) ARGS+=("--no-optional") ;; esac
fi

read -r -p "Output directory (blank for default): " outdir
[ -n "$outdir" ] && ARGS+=("--out=$outdir")

[ -n "$DRY_RUN_FLAG" ] && ARGS+=("$DRY_RUN_FLAG")

echo ""
echo "Running: export-bundle ${ARGS[*]}"
exec node "$EXPORT_SCRIPT" "${ARGS[@]}"
