#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Bundle the kiosk into an .AppImage (or .deb).
#
#   ./build.sh                      ask for the install settings, then build
#   ./build.sh --yes                take the defaults from <kiosk>/frontend/config.yaml
#   KIOSK_DIR=healthcare-service-kiosk ./build.sh  build another kiosk (default: public-service-kiosk)
#   ./build.sh --mode=touch --targets=appimage,deb --windowed
#   ./build.sh --no-build           reuse the last kiosk server build
#   ./build.sh --stage-only         assemble the bundle, don't package it
#   ./build.sh --dev                run the shell without packaging
#   ./build.sh --shell-only         package just the shell, unpacked (external-target mode)
#   ./build.sh --bundle-app         package build/kiosk-studio (every kiosk in
#                                   KIOSK_DIR_LIST a sample of one studio) as the app
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
# --bundle-app carries every kiosk in KIOSK_DIR_LIST (colon separated), so each gets the same.
KIOSK_DIR="${KIOSK_DIR:-public-service-kiosk}"
case "$KIOSK_DIR" in /*) ;; *) KIOSK_DIR="$(cd ../.. && pwd)/$KIOSK_DIR" ;; esac
export KIOSK_DIR
IFS=: read -r -a kiosk_dirs <<<"${KIOSK_DIR_LIST:-$KIOSK_DIR}"
for dir in "${kiosk_dirs[@]}"; do
  case "$dir" in /*) ;; *) dir="$(cd ../.. && pwd)/$dir" ;; esac
  if [ ! -f "$dir/frontend/config.yaml" ]; then
    cp "$dir/frontend/configs/${KIOSK_PROFILE:-reference}.yaml" "$dir/frontend/config.yaml"
    echo "Created $dir/frontend/config.yaml from the ${KIOSK_PROFILE:-reference} profile"
  fi
  KIOSK_DIR="$dir" node ../scripts/ensure-admin-password.mjs
done

exec node scripts/build.mjs "$@"
