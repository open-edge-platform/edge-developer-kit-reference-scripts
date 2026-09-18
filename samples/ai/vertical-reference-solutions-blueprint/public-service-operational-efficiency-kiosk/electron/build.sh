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
#   ./build.sh --shell-only         package just the shell, unpacked (external-target mode)
#   ./build.sh --bundle-app         package build/kiosk-studio as the app
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

red() { printf '\033[31m%s\033[0m\n' "$1"; }
dim() { printf '\033[2m%s\033[0m\n' "$1"; }

if ! command -v node >/dev/null 2>&1; then
  red "✗ node is not on PATH — the kiosk server is a Node app and the shell's build runs on it."
  dim "  Install Node 20 or newer: https://nodejs.org"
  exit 1
fi

major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 20 ]; then
  red "✗ node $(node -v) is too old — Next needs 20 or newer."
  exit 1
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
