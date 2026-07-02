#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UV_CMD="$SCRIPT_DIR/../thirdparty/uv/uv"
PYPROJECT_FILE="$SCRIPT_DIR/pyproject.toml"
DEPLOYMENT_DIR="$SCRIPT_DIR/deployment"

check_uv() {
    if [ -x "$UV_CMD" ]; then
        return 0
    fi
    echo "ERROR: uv not found at $UV_CMD"
    echo "Please run the workers setup script first."
    exit 1
}

check_uv

if [ ! -f "$PYPROJECT_FILE" ]; then
    echo "ERROR: pyproject.toml not found at $PYPROJECT_FILE"
    exit 1
fi

if [ ! -d "$DEPLOYMENT_DIR" ]; then
    echo ""
    echo "WARNING: Deployment folder not found at $DEPLOYMENT_DIR"
    echo "Please unzip your Geti code deployment ZIP into:"
    echo "  $DEPLOYMENT_DIR"
    echo ""
    echo "Expected structure:"
    echo "  deployment/"
    echo "  \u251c\u2500\u2500 project.json"
    echo "  \u2514\u2500\u2500 Classification/"
    echo "      \u251c\u2500\u2500 model.json"
    echo "      \u251c\u2500\u2500 model/"
    echo "      \u2502   \u251c\u2500\u2500 model.xml"
    echo "      \u2502   \u251c\u2500\u2500 model.bin"
    echo "      \u2502   \u2514\u2500\u2500 config.json"
    echo "      \u2514\u2500\u2500 python/"
    echo "          \u2514\u2500\u2500 requirements.txt"
fi

cd "$SCRIPT_DIR"
exec "$UV_CMD" run main.py "$@"
