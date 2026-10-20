#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Build the Vertical Reference Solutions Blueprint for production.
#
# The embedded bundle packaged as a desktop app, one per kiosk — or, with
# --mock, the kiosk alone with its AI mocked, no studio anywhere. The install
# questions come first; the long work (installs, frontend build, studio
# export, packaging) only starts after them.
#
#   ./setup.sh --build [-- <build args>]                     set up the kiosks, then build
#   common/scripts/build.sh                                   ask for the install settings, then build
#                                                             every kiosk ./setup.sh set up
#   common/scripts/build.sh --kiosk healthcare                just that one
#   common/scripts/build.sh --mock                            no studio: mocked AI, simulated hardware
#   common/scripts/build.sh -- --yes --targets=appimage,deb   non-interactive
#
# See docs/build.md.

# shellcheck source=common.sh disable=SC1091
. "$(cd "$(dirname "$0")" && pwd)/common.sh"

KIOSK_ARG="" MOCK=0

usage() {
  cat <<EOF
Usage: common/scripts/build.sh [--kiosk <names>] [--mock] [-- <extra args>]
   or: ./setup.sh --build [--kiosk <names>] [--mock] [-- <extra args>]   (sets the kiosks up first)

Builds the embedded bundle packaged as a desktop app (.AppImage and/or .deb —
the build asks which, before any long work starts) for every kiosk ./setup.sh
set up: a minimal studio export with the kiosk injected as a sample, shipped
pre-setup. First launch on the terminal unpacks it, runs the studio's setup
(runtimes, worker envs — downloads), then starts the studio as the main
process — the window opens on it — and the studio runs the kiosk as its own
worker on another URL. Packages are copied to build/ at the repo root, the
exported bundles go to build/kiosk-studio/<kiosk>/. Works from a totally
clean checkout: missing dependencies are installed on the way. The Edge AI
Studio checkout at \$EDGE_AI_STUDIO_DIR is only the export source — it does
not need to be set up.

Options:
  --kiosk <names>   which kiosks: $(kiosk_ids | sed 's/ /, /g') or all, comma separated
                    (default: what ./setup.sh saved)
  --mock            no studio: package the kiosk alone, its AI mocked and its
                    hardware simulated when absent, as build/<product>-<version>-mock.AppImage.
                    Needs no studio checkout. Run it with ./start.sh --desktop --mock
  -h, --help        this help

Extra args after --, for every kiosk's build:
  --yes, --fullscreen, --windowed, --targets=appimage,deb      go to the shell
  anything else (--mode, --llm, --port, --allow-missing, ...)  goes to scripts/bundle.mjs

Studio location: EDGE_AI_STUDIO_DIR (env or .kioskrc), currently:
  $EDGE_AI_STUDIO_DIR
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --kiosk) shift; KIOSK_ARG="${1:-}"; [ -n "$KIOSK_ARG" ] || die "--kiosk needs a value" ;;
    --mock) MOCK=1 ;;
    --) shift; break ;;
    *) usage; die "unknown argument: $1 (the web/desktop/studio/bundle targets were removed — this is the only build method for now)" ;;
  esac
  shift
done

resolve_kiosks "$KIOSK_ARG"
require_node

# The embedded bundle, or with --mock the kiosk alone.
if [ "$MOCK" -eq 1 ]; then FLOW=(--mock); else FLOW=(--bundle-app); fi

# electron/build.sh checks the toolchain, asks the install questions, exports
# the bundle (scripts/bundle.mjs) and packages it — all in one process, so the
# questions really do come before the long work.
if [ "${#KIOSK_DIRS[@]}" -eq 1 ]; then
  ensure_config
  ensure_admin_password
  exec "$ELECTRON_DIR/build.sh" "${FLOW[@]}" "$@"
fi

# Several kiosks: every kiosk's questions first, then the builds one after
# another (they share electron/'s staging directories).
ANSWERS=()
for dir in "${KIOSK_DIRS[@]}"; do
  use_kiosk "$dir"
  ensure_config
  ensure_admin_password
  info "Build settings for $(kiosk_label "$dir")"
  answers="$(build_answers "${FLOW[@]}" "$@")" || die "the build's questions were not answered"
  [ -n "$answers" ] || die "the build's questions were not answered"
  ANSWERS+=("$answers")
done
for i in "${!KIOSK_DIRS[@]}"; do
  use_kiosk "${KIOSK_DIRS[$i]}"
  info "Building $(kiosk_label "$KIOSK_DIR") ($((i + 1)) of ${#KIOSK_DIRS[@]})"
  mapfile -t args < <(printf '%s\n' "${ANSWERS[$i]}")
  "$ELECTRON_DIR/build.sh" "${FLOW[@]}" "${args[@]}"
done
ok "Packages for $(selected_kiosk_ids) are in ${BUILD_DIR#"$WORKSPACE_ROOT"/}/"
