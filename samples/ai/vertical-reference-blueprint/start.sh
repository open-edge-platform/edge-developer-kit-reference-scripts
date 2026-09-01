#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Start the Vertical Reference Blueprint — production server plus its Edge AI Studio prerequisite.
#
#   ./start.sh              start the studio (if needed) + the kiosk on :3000
#   ./start.sh --mock       start with mocked AI (no studio required)
#   ./start.sh --rebuild    force a fresh production build first
#
# See docs/getting-started.md.

# shellcheck source=scripts/common.sh disable=SC1091
. "$(cd "$(dirname "$0")" && pwd)/scripts/common.sh"

MOCK=0 NO_STUDIO=0 REBUILD=0 TAURI=0 BUNDLE=0 PORT_ARG=""

usage() {
  cat <<EOF
Usage: ./start.sh [options]

Starts the blueprint for normal use:
  1. ensures the Edge AI Studio gateway is running (starts it if not)
  2. builds the frontend if no production build exists
  3. serves the kiosk at http://localhost:3000

Options:
  --mock         run with mocked AI services (skips the studio entirely)
  --no-studio    don't start/check the studio, keep live AI settings
                 (use when the gateway runs on another machine — set STUDIO_URL)
  --tauri        launch the desktop shell instead of the web server
                 (still auto-starts the studio first; usually combined with
                 --bundle — build the app with ./build.sh)
  --bundle       start the embedded bundle (build/kiosk-studio): the minimal
                 studio boots and starts the kiosk as its own hidden child
                 process. Combine with --tauri for a desktop window on the
                 studio (its kiosk sample runs the kit on its own URL).
                 Build it first: ./build.sh
  --rebuild      force a fresh production build
  --port <n>     serve on a different port (default 3000; with --tauri this
                 pins KIOSK_PORT for the app's internal server)
  -h, --help     this help

The studio is left running when you stop the kiosk (Ctrl+C); stop it separately
if you need to. Studio location/behaviour: EDGE_AI_STUDIO_DIR, STUDIO_URL,
STUDIO_RUN_MODE, STUDIO_AUTOSTART — via env or .kioskrc (docs/configuration.md).
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --mock) MOCK=1 ;;
    --no-studio) NO_STUDIO=1 ;;
    --tauri) TAURI=1 ;;
    --bundle) BUNDLE=1 ;;
    --rebuild) REBUILD=1 ;;
    --port) shift; PORT_ARG="${1:-}"; [ -n "$PORT_ARG" ] || die "--port needs a value" ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "unknown option: $1" ;;
  esac
  shift
done

require_node

# Embedded-bundle mode: the bundle's own studio is the process manager — it
# boots on :8080 and starts the kiosk as a hidden worker process, so none of
# the normal studio/build/serve steps below apply.
if [ "$BUNDLE" -eq 1 ]; then
  BUNDLE_DIR="${KIOSK_BUNDLE_DIR:-$REPO_ROOT/build/kiosk-studio}"
  [ -f "$BUNDLE_DIR/bundle.env" ] \
    || die "no bundle at $BUNDLE_DIR — build one first: ./build.sh"
  # shellcheck disable=SC1091
  . "$BUNDLE_DIR/bundle.env"
  [ -f "$BUNDLE_DIR/studio/frontend/.next/BUILD_ID" ] \
    || die "bundle not set up yet — run: ./setup.sh --bundle  (or: cd $BUNDLE_DIR/studio && ./setup.sh)"

  if [ "$TAURI" -eq 1 ]; then
    APP="$(desktop_app_path || true)"
    [ -n "$APP" ] || die "no desktop build found — build one first: ./build.sh"
    info "Launching the desktop shell on the embedded bundle (studio :8080, kiosk :$KIOSK_BUNDLE_PORT)"
    # External-target mode of the shell (tauri/src-tauri/src/main.rs): it runs
    # the bundle's start script and opens the window on the studio, whose
    # samples gallery links to the kiosk running on its own URL.
    export KIOSK_SHELL_URL="${KIOSK_SHELL_URL:-http://127.0.0.1:8080}"
    export KIOSK_SHELL_CMD="bash ./start.sh"
    export KIOSK_SHELL_CWD="$BUNDLE_DIR/studio"
    export KIOSK_SHELL_TIMEOUT_SECS="${KIOSK_SHELL_TIMEOUT_SECS:-900}"
    exec "$APP"
  fi

  info "Starting the embedded bundle (studio :8080, kiosk :$KIOSK_BUNDLE_PORT, mode: ${KIOSK_BUNDLE_MODE:-?})"
  cd "$BUNDLE_DIR/studio" || die "cannot enter $BUNDLE_DIR/studio"
  exec bash ./start.sh
fi

ensure_frontend_deps
ensure_config
ensure_admin_password

KIOSK_PORT="${PORT_ARG:-${PORT:-3000}}"
export PORT="$KIOSK_PORT" # next start listens here; the CMS proxy URL derives from it too

# 1. Prerequisite: Edge AI Studio ------------------------------------------
if [ "$MOCK" -eq 1 ]; then
  export_mock_env
elif [ "$NO_STUDIO" -eq 1 ] || [ "$STUDIO_AUTOSTART" = "0" ]; then
  info "Not managing the studio (--no-studio); expecting live services at $STUDIO_URL"
  if studio_up; then
    studio_check_services
  else
    warn "studio gateway not reachable at $STUDIO_URL — the kiosk may show its out-of-service screen"
  fi
else
  ensure_studio
fi

# 2. Desktop app mode -------------------------------------------------------
# The packaged Tauri app carries its own frontend build, Node runtime, and a
# pre-seeded database, and spawns its own web-server process on a loopback
# port — so with --tauri the studio is up (step 1) and we just launch the app.
if [ "$TAURI" -eq 1 ]; then
  APP="$(desktop_app_path || true)"
  [ -n "$APP" ] || die "no desktop build found — package one first: ./build.sh"
  [ -n "$PORT_ARG" ] && export KIOSK_PORT="$PORT_ARG"
  info "Launching the desktop kiosk: $APP"
  exec "$APP"
fi

# 3. Database priming (first run only) -------------------------------------
# Payload only creates + seeds the SQLite schema outside production, so a fresh
# checkout needs one dev boot before `next start` can serve.
if [ ! -s "$FRONTEND_DIR/db.sqlite" ]; then
  info "No database yet — priming db.sqlite with a one-off dev boot (first run only)"
  rm -f "$REPO_ROOT/.prime.log"
  (cd "$FRONTEND_DIR" && setsid nohup npm run dev >"$REPO_ROOT/.prime.log" 2>&1 & echo $! >"$REPO_ROOT/.prime.pid")
  PRIME_PID="$(cat "$REPO_ROOT/.prime.pid")"
  waited=0
  until [ -s "$FRONTEND_DIR/db.sqlite" ]; do
    curl -s -o /dev/null --max-time 5 "http://localhost:$KIOSK_PORT/admin" || true
    sleep 3
    waited=$((waited + 3))
    if [ "$waited" -ge 240 ]; then
      kill -- "-$PRIME_PID" 2>/dev/null || true
      die "database was not created within 240s — check $REPO_ROOT/.prime.log"
    fi
  done
  sleep 3 # let seeding finish writing
  kill -- "-$PRIME_PID" 2>/dev/null || true
  rm -f "$REPO_ROOT/.prime.pid"
  ok "Database created and seeded"
fi

# 4. Production build -------------------------------------------------------
if [ "$REBUILD" -eq 1 ] || [ ! -f "$FRONTEND_DIR/.next/BUILD_ID" ]; then
  info "Building the frontend (production)"
  (cd "$FRONTEND_DIR" && npm run build)
else
  info "Reusing existing production build (use --rebuild to force a fresh one)"
fi

# 5. Serve ------------------------------------------------------------------
info "Starting the kiosk at http://localhost:$KIOSK_PORT"
echo "    kiosk UI      http://localhost:$KIOSK_PORT"
echo "    admin (CMS)   http://localhost:$KIOSK_PORT/admin  ($(kiosk_admin_login))"
echo "    health        http://localhost:$KIOSK_PORT/api/health"
echo
cd "$FRONTEND_DIR" || die "cannot enter $FRONTEND_DIR"
exec npm run start
