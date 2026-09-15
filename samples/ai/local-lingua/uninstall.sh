#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Tears down what setup.sh/start.sh created, for a clean re-test of the setup
# flow. Stops containers and removes models/venv/data/.env. Does NOT uninstall
# Docker or system packages. Thin wrapper around `make stop` + `make clean`
# (+ optional `make demo-clean`).
#
# Usage:
#   ./uninstall.sh              Interactive (asks before removing demo assets)
#   ./uninstall.sh --demo       Non-interactive, also remove demo assets
#   ./uninstall.sh --no-demo    Non-interactive, keep demo assets
#   ./uninstall.sh -h|--help    Show this help

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

demo_choice=""
for arg in "$@"; do
    case "$arg" in
        -y|--yes|--demo) demo_choice="yes" ;;
        --no-demo) demo_choice="no" ;;
        -h|--help)
            sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "Unknown option: $arg" >&2
            exit 1
            ;;
    esac
done

make stop
make clean

echo ""
if [ -z "$demo_choice" ]; then
    if [ -t 0 ]; then
        read -rp "Also remove demo voice samples and Mission Cues PDF? [y/N] " reply
        [[ "$reply" =~ ^[Yy]$ ]] && demo_choice="yes" || demo_choice="no"
    else
        echo "[*] Non-interactive shell — keeping demo assets (pass --demo to remove them)."
        demo_choice="no"
    fi
fi

if [ "$demo_choice" = "yes" ]; then
    make demo-clean
fi

echo ""
echo "Uninstall complete. Run ./setup.sh to set up again."
