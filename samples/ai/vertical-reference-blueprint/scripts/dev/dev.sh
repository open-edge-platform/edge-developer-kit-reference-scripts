#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Run the Vertical Reference Blueprint in development mode (hot reload).
#
#   scripts/dev/dev.sh            studio (if needed) + Next.js dev server on :3000
#   scripts/dev/dev.sh --mock     mocked AI — zero external dependencies
#   scripts/dev/dev.sh --tauri    run the desktop shell in dev mode instead
#
# See docs/dev-mode.md.

# shellcheck source=../common.sh disable=SC1091
. "$(cd "$(dirname "$0")" && pwd)/../common.sh"

MOCK=0 NO_STUDIO=0 TAURI=0
EXTRA_ARGS=()

usage() {
  cat <<EOF
Usage: scripts/dev/dev.sh [options] [-- <extra args>]

Development mode: ensures the Edge AI Studio gateway is running, then starts
the Next.js dev server (hot reload) at http://localhost:3000.

Options:
  --mock         mock the AI services (KIOSK_LLM_MOCK=true, verification off);
                 the studio is not started — best for pure UI work
  --no-studio    don't start/check the studio, keep live AI settings
  --tauri        run the desktop (Tauri) shell in dev mode instead of the
                 browser dev server; extra args after -- go to tauri's build
                 script (e.g. scripts/dev/dev.sh --tauri -- --yes --mode=touch)
  -h, --help     this help

Config precedence and all settings: docs/configuration.md.
Prefer frontend/config.local.yaml for persistent personal overrides.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --mock) MOCK=1 ;;
    --no-studio) NO_STUDIO=1 ;;
    --tauri) TAURI=1 ;;
    --) shift; EXTRA_ARGS=("$@"); break ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "unknown option: $1" ;;
  esac
  shift
done

require_node
ensure_frontend_deps
ensure_config
ensure_admin_password

if [ "$MOCK" -eq 1 ]; then
  export_mock_env
elif [ "$NO_STUDIO" -eq 1 ] || [ "$STUDIO_AUTOSTART" = "0" ]; then
  info "Not managing the studio; expecting live services at $STUDIO_URL"
  if studio_up; then
    studio_check_services
  else
    warn "studio gateway not reachable at $STUDIO_URL — expect the out-of-service screen (or use --mock)"
  fi
else
  ensure_studio
fi

if [ "$TAURI" -eq 1 ]; then
  info "Starting the desktop shell in dev mode (tauri/)"
  cd "$TAURI_DIR" || die "cannot enter $TAURI_DIR"
  exec npm run dev -- ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
fi

info "Starting the Next.js dev server at http://localhost:3000"
echo "    kiosk UI      http://localhost:3000"
echo "    chat/voice    http://localhost:3000/chat"
echo "    enroll desk   http://localhost:3000/enroll"
echo "    admin (CMS)   http://localhost:3000/admin  ($(kiosk_admin_login))"
echo "    health        http://localhost:3000/api/health"
echo
cd "$FRONTEND_DIR" || die "cannot enter $FRONTEND_DIR"
exec npm run dev ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
