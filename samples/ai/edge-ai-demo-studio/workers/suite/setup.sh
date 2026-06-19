#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "[suite/setup] $*"; }

shopt -s nullglob
for suite_dir in "$SCRIPT_DIR"/*/; do
  setup_script="$suite_dir/setup.sh"
  suite_name=$(basename "$suite_dir")
  if [ -f "$setup_script" ]; then
    for app_dir in "$suite_dir"*/; do
      [ -d "$app_dir" ] || continue
      app_name=$(basename "$app_dir")
      # skip hidden dirs (e.g. .cache)
      [[ "$app_name" == .* ]] && continue
      # only setup dirs that have a suite.env (i.e. are actual app dirs)
      [ -f "$app_dir/suite.env" ] || continue
      log "Running $suite_name/$app_name setup"
      bash "$setup_script" "$app_name"
    done
  fi
done
