#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# One-time setup: installs system packages, Docker, GPU/NPU device access,
# the Python env, and downloads/exports the AI models. Requires internet.
# Thin wrapper around `make prereq` (+ optional `make demo-prereq`) for users
# who'd rather not install make or read the Makefile by hand.
#
# Safe to re-run: `make prereq` skips packages/models already installed, and
# demo assets are only (re)fetched when requested or missing.
#
# Usage:
#   ./setup.sh                 Interactive (prompts for the demo assets)
#   ./setup.sh --demo          Non-interactive, also install demo assets
#   ./setup.sh --no-demo       Non-interactive, skip demo assets
#   ./setup.sh -h|--help       Show this help

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

demo_choice=""
for arg in "$@"; do
    case "$arg" in
        -y|--yes|--demo) demo_choice="yes" ;;
        --no-demo) demo_choice="no" ;;
        -h|--help)
            sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "Unknown option: $arg" >&2
            exit 1
            ;;
    esac
done

if ! command -v make >/dev/null 2>&1; then
    echo "[*] 'make' not found — installing..."
    sudo apt-get update -qq
    sudo apt-get install -y --no-install-recommends make
fi

make prereq

echo ""
if [ -z "$demo_choice" ]; then
    if [ -t 0 ]; then
        read -rp "Download demo voice samples and enable the in-app Demo button? [y/N] " reply
        [[ "$reply" =~ ^[Yy]$ ]] && demo_choice="yes" || demo_choice="no"
    else
        echo "[*] Non-interactive shell — skipping demo assets (pass --demo to include them)."
        demo_choice="no"
    fi
fi

if [ "$demo_choice" = "yes" ]; then
    make demo-prereq
fi


echo ""
echo "Setup complete. Run ./start.sh to launch the app."
