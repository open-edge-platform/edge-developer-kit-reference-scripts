#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# verify_thirdparty.sh [<project root>] [--full] -- check the third-party tools setup installed against
# their install manifests (thirdparty_integrity.sh). Prints "<tool> (<path>): <problems>" for each one
# that is damaged, was changed or was never checked, and exits 1; exits 0 when all are intact. It
# compares sizes only, fast enough for every start (start.sh, the Electron app); --full compares
# SHA-256 as well, as setup does. A tool that is not installed is left to whatever needs it.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/thirdparty_integrity.sh
source "$SCRIPT_DIR/thirdparty_integrity.sh"

project_root=""
mode="quick"
for arg in "$@"; do
  case "$arg" in
    --full) mode="full" ;;
    *) project_root="$arg" ;;
  esac
done
# In the repo this file is in scripts/bash/; in a packaged build, in scripts/.
if [ -z "$project_root" ]; then
  if [ "$(basename "$SCRIPT_DIR")" = "bash" ]; then
    project_root="$(cd "$SCRIPT_DIR/../.." && pwd)"
  else
    project_root="$(cd "$SCRIPT_DIR/.." && pwd)"
  fi
fi

installs=(
  "Node.js|thirdparty/node"
  "FFmpeg|thirdparty/ffmpeg"
  "qmassa|thirdparty/qmassa"
  "uv|workers/thirdparty/uv"
  "OpenVINO Model Server|workers/thirdparty/ovms"
  "llama.cpp (Vulkan)|workers/engines/multiserve/engine/llama.cpp-vulkan"
  "llama.cpp (SYCL)|workers/engines/multiserve/engine/llama.cpp-sycl"
  "GGUF parser|workers/engines/multiserve/engine/gguf-parser"
)

failed=0
for install in "${installs[@]}"; do
  tool="${install%%|*}"
  path="$project_root/${install#*|}"
  [ -e "$path" ] || continue
  if ! problems="$(check_install "$path" "" "$mode")"; then
    echo "$tool ($path): $(summarize_problems "$problems")"
    failed=1
  fi
done
exit "$failed"
