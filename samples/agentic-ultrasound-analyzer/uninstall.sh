#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -Eeuo pipefail

SAMPLE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

remove_directory() {
    local directory="$1"
    if [[ -e "$directory" || -L "$directory" ]]; then
        rm -rf -- "$directory"
        echo "Removed: $directory"
    else
        echo "Not found, skipping: $directory"
    fi
}

remove_directory "$SAMPLE_DIR/venv"
remove_directory "$SAMPLE_DIR/scripts/models"