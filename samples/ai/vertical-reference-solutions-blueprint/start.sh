#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Start the Vertical Reference Solutions Blueprint — the production kiosk server.
#
#   ./start.sh              start the Edge AI Studio (if needed) and the kiosk on :3000
#   ./start.sh --no-studio  kiosk only, using whatever gateway is up
#   ./start.sh --wait-studio  wait for a gateway started elsewhere
#   ./start.sh --mock       start with mocked AI (no studio required)
#   ./start.sh --rebuild    force a fresh production build first
#
# See docs/getting-started.md.

# shellcheck source=scripts/common.sh disable=SC1091
. "$(cd "$(dirname "$0")" && pwd)/scripts/common.sh"

MOCK=0 STUDIO=1 WAIT_STUDIO=0 REBUILD=0 DESKTOP=0 BUNDLE=0 PORT_ARG=""

usage() {
  cat <<EOF
Usage: ./start.sh [options]

Starts the blueprint for normal use:
  1. builds the frontend if no production build exists
  2. serves the kiosk at http://localhost:3000

The Edge AI Studio is started from \$EDGE_AI_STUDIO_DIR when its gateway isn't
already live at \$STUDIO_URL, and waited for before the kiosk serves — a missing
studio checkout is an error. --no-studio serves the kiosk against whatever is
live and reports the rest on its health page.

Options:
  --no-studio    don't start or wait for the studio: serve against whatever is
                 live at \$STUDIO_URL
  --studio       accepted for compatibility — starting the studio (if it isn't
                 already running) and waiting for its gateway is now the default
  --wait-studio  don't start the studio, but wait for its gateway to answer at
                 \$STUDIO_URL (someone else launches it — another machine, a
                 service unit, the studio app)
  --mock         run with mocked AI services (skips the studio entirely)
  --desktop      launch the desktop shell instead of the web server
                 (usually combined with --bundle — build the app with scripts/build.sh)
  --bundle       start the embedded bundle (build/kiosk-studio): the minimal
                 studio boots and starts the kiosk as its own hidden child
                 process. Combine with --desktop for a desktop window on the
                 studio (its kiosk sample runs the kit on its own URL).
                 Build it first: scripts/build.sh
  --rebuild      force a fresh production build
  --port <n>     serve on a different port (default 3000; with --desktop this
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
    --studio) STUDIO=1 ;;
    --wait-studio) WAIT_STUDIO=1 ;;
    --no-studio) STUDIO=0; WAIT_STUDIO=0 ;;
    --desktop) DESKTOP=1 ;;
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
    || die "no bundle at $BUNDLE_DIR — build one first: scripts/build.sh"
  # shellcheck disable=SC1091
  . "$BUNDLE_DIR/bundle.env"
  [ -f "$BUNDLE_DIR/studio/frontend/.next/BUILD_ID" ] \
    || die "bundle not set up yet — run: ./setup.sh --bundle  (or: cd $BUNDLE_DIR/studio && ./setup.sh)"

  if [ "$DESKTOP" -eq 1 ]; then
    APP="$(desktop_app_path || true)"
    [ -n "$APP" ] || die "no desktop build found — build one first: scripts/build.sh"
    info "Launching the desktop shell on the embedded bundle (studio :8080, kiosk :$KIOSK_BUNDLE_PORT)"
    # External-target mode of the shell (electron/main.js): it runs
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

# 1. Edge AI Studio ---------------------------------------------------------
# Started and waited for by default (a missing checkout is fatal); --wait-studio
# only waits; --no-studio serves regardless of the gateway (the kiosk's health
# page reports what is missing).
if [ "$STUDIO" -eq 1 ] && [ "$STUDIO_AUTOSTART" = "0" ]; then
  info "STUDIO_AUTOSTART=0 — not launching the studio, only waiting for it"
  STUDIO=0 WAIT_STUDIO=1
fi

if [ "$MOCK" -eq 1 ]; then
  export_mock_env
elif [ "$STUDIO" -eq 1 ]; then
  ensure_studio
elif [ "$WAIT_STUDIO" -eq 1 ]; then
  studio_up || studio_wait
  studio_check_services
else
  info "Not managing the studio (--no-studio); using whatever is live at $STUDIO_URL"
  if studio_up; then
    studio_check_services
  else
    warn "studio gateway not reachable at $STUDIO_URL — the kiosk may show its out-of-service screen"
  fi
fi

# 2. Desktop app mode -------------------------------------------------------
# The packaged desktop app carries its own frontend build and a pre-seeded
# database, and spawns its own web-server process on a loopback port — so
# after step 1 we just launch the app.
if [ "$DESKTOP" -eq 1 ]; then
  APP="$(desktop_app_path || true)"
  [ -n "$APP" ] || die "no desktop build found — package one first: scripts/build.sh"
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
