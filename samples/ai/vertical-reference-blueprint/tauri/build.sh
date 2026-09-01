#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Bundle the kiosk into an .AppImage (or .deb).
#
#   ./build.sh                      ask for the install settings, then build
#   ./build.sh --yes                take the defaults from frontend/config.yaml
#   ./build.sh --mode=touch --targets=appimage,deb --windowed
#   ./build.sh --no-build           reuse the last kiosk server build
#   ./build.sh --stage-only         assemble the bundle, don't package it
#   ./build.sh --dev                run the shell without packaging
#   ./build.sh --shell-only         compile just the shell binary (external-target mode)
#   ./build.sh --bundle-app         package build/kiosk-studio as the app
#
# Checks the toolchain first, because Tauri's own error for a missing system
# library is a page of C linker output.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

red() { printf '\033[31m%s\033[0m\n' "$1"; }
dim() { printf '\033[2m%s\033[0m\n' "$1"; }

missing=()

if ! command -v node >/dev/null 2>&1; then
  red "✗ node is not on PATH — the kiosk server is a Node app and the bundle ships a copy of the runtime you build with."
  dim "  Install Node 20 or newer: https://nodejs.org"
  exit 1
fi

major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 20 ]; then
  red "✗ node $(node -v) is too old — Next needs 20 or newer, and this is the runtime that gets bundled."
  exit 1
fi

command -v cargo >/dev/null 2>&1 || missing+=("the Rust toolchain")

if command -v pkg-config >/dev/null 2>&1; then
  pkg-config --exists webkit2gtk-4.1 || missing+=("libwebkit2gtk-4.1-dev")
else
  missing+=("pkg-config")
fi

if [ "${#missing[@]}" -gt 0 ]; then
  red "✗ missing: ${missing[*]}"
  echo
  if [ -t 0 ]; then
    read -r -p "  Install them now with scripts/setup-linux.sh? [Y/n] " answer
    case "${answer:-y}" in
      [Yy]*)
        ./scripts/setup-linux.sh
        # rustup drops cargo here, and this shell has not picked it up yet.
        if [ -f "$HOME/.cargo/env" ]; then
          # shellcheck disable=SC1091
          . "$HOME/.cargo/env"
        fi
        ;;
      *) dim "  Run scripts/setup-linux.sh when you are ready."; exit 1 ;;
    esac
  else
    dim "  Run scripts/setup-linux.sh, or see https://tauri.app/start/prerequisites/"
    exit 1
  fi
fi

# The shipped config.yaml is baked into the package, so it has to exist and
# carry an admin password before the build reads it (a direct run here skips
# the root launchers, which is where ensure_config/ensure_admin_password live).
if [ ! -f ../frontend/config.yaml ]; then
  cp "../frontend/configs/${KIOSK_PROFILE:-reference}.yaml" ../frontend/config.yaml
  echo "Created frontend/config.yaml from the ${KIOSK_PROFILE:-reference} profile"
fi
node ../scripts/ensure-admin-password.mjs

exec node scripts/build.mjs "$@"
