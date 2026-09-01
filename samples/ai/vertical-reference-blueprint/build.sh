#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Build the Vertical Reference Blueprint for production.
#
# One build method (for now): the embedded bundle packaged as a desktop app.
# The install questions come first; the long work (installs, frontend build,
# studio export, Rust build) only starts after them.
#
#   ./build.sh                                   ask for the install settings, then build
#   ./build.sh -- --yes --targets=appimage,deb   non-interactive
#
# See docs/build.md.

# shellcheck source=scripts/common.sh disable=SC1091
. "$(cd "$(dirname "$0")" && pwd)/scripts/common.sh"

usage() {
  cat <<EOF
Usage: ./build.sh [-- <extra args>]

Builds the embedded bundle packaged as a desktop app (.AppImage and/or .deb —
the build asks which, before any long work starts): a minimal studio export
with the kiosk injected as a sample, shipped pre-setup. First launch on the
terminal unpacks it, runs the studio's setup (runtimes, worker envs —
downloads), then starts the studio as the main process — the window opens on
it — and the studio runs the blueprint as its own worker on another URL.
Packages are copied to build/. Works from a totally clean checkout: missing
dependencies are installed on the way.

Extra args after --:
  --yes, --fullscreen, --windowed, --targets=appimage,deb   go to the shell
  anything else (--mode, --port, --allow-missing, ...)      goes to scripts/bundle.sh

Options:
  -h, --help      this help

Studio location: EDGE_AI_STUDIO_DIR (env or .kioskrc), currently:
  $EDGE_AI_STUDIO_DIR
EOF
}

if [ $# -gt 0 ]; then
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --) : ;;
    *) usage; die "unknown argument: $1 (the web/desktop/studio/bundle targets were removed — this is the only build method for now)" ;;
  esac
fi
if [ "${1:-}" = "--" ]; then shift; fi

require_node
ensure_config
ensure_admin_password

# tauri/build.sh checks the toolchain, asks the install questions, exports the
# bundle (scripts/bundle.sh) and packages it — all in one process, so the
# questions really do come before the long work.
exec "$TAURI_DIR/build.sh" --bundle-app "$@"
