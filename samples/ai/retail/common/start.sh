#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Start the Vertical Reference Solutions Blueprint — the production kiosk servers.
#
#   ./start.sh              start the Edge AI Studio (if needed) and the kiosks
#                           ./setup.sh set up, each on its own port
#   ./start.sh --kiosk healthcare   just that one, this time
#   ./start.sh --no-studio  kiosks only, using whatever gateway is up
#   ./start.sh --wait-studio  wait for a gateway started elsewhere
#   ./start.sh --mock       start with mocked AI (no studio required)
#   ./start.sh --desktop --mock   open the mocked desktop apps (./setup.sh --build --mock)
#   ./start.sh --rebuild    force a fresh production build first
#
# See docs/getting-started.md.

# shellcheck source=scripts/common.sh disable=SC1091
. "$(cd "$(dirname "$0")" && pwd)/scripts/common.sh"

MOCK=0 STUDIO=1 WAIT_STUDIO=0 REBUILD=0 DESKTOP=0 BUNDLE=0 PORT_ARG="" KIOSK_ARG=""

usage() {
  cat <<EOF
Usage: ./start.sh [options]

Starts the blueprint for normal use — every kiosk ./setup.sh set up, or the
ones --kiosk names:
  1. builds each kiosk's frontend if no production build exists
  2. serves each kiosk on its own port (kiosk.json "port": public-service
     http://localhost:3000, healthcare http://localhost:3001)

The Edge AI Studio is started from \$EDGE_AI_STUDIO_DIR when its gateway isn't
already live at \$STUDIO_URL, and waited for before the kiosks serve — a missing
studio checkout is an error. One studio serves every kiosk. --no-studio serves
the kiosks against whatever is live and reports the rest on their health page.

Options:
  --kiosk <names>  which kiosks this time: $(kiosk_ids | sed 's/ /, /g') or all, comma
                 separated (default: what ./setup.sh saved).
                 <kiosk>/scripts/start.sh starts that kiosk alone
  --no-studio    don't start or wait for the studio: serve against whatever is
                 live at \$STUDIO_URL
  --studio       accepted for compatibility — starting the studio (if it isn't
                 already running) and waiting for its gateway is now the default
  --wait-studio  don't start the studio, but wait for its gateway to answer at
                 \$STUDIO_URL (someone else launches it — another machine, a
                 service unit, the studio app)
  --mock         run with mocked AI services (skips the studio entirely)
  --desktop      launch the desktop shell instead of the web server
                 (usually combined with --bundle — build the app with
                 ./setup.sh --build). One kiosk only — except with --mock, which
                 opens the mocked app of every kiosk (./setup.sh --build --mock)
  --bundle       start the embedded bundle (build/kiosk-studio/<kiosk>): the
                 minimal studio boots and starts the kiosk as its own hidden child
                 process. Combine with --desktop for a desktop window on the
                 studio (its kiosk sample runs the kit on its own URL).
                 Build it first: ./setup.sh --bundle. One kiosk only
  --rebuild      force a fresh production build
  --port <n>     serve on a different port (with several kiosks: the first on
                 <n>, the next on <n+1>, ...; with --desktop this pins
                 KIOSK_PORT for the app's internal server)
  -h, --help     this help

The studio is left running when you stop the kiosks (Ctrl+C); stop it separately
if you need to. Studio location/behaviour: EDGE_AI_STUDIO_DIR, STUDIO_URL,
STUDIO_RUN_MODE, STUDIO_AUTOSTART — via env or .kioskrc (docs/configuration.md).
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --kiosk) shift; KIOSK_ARG="${1:-}"; [ -n "$KIOSK_ARG" ] || die "--kiosk needs a value" ;;
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

resolve_kiosks "$KIOSK_ARG"
if [ "${#KIOSK_DIRS[@]}" -gt 1 ] && { [ "$BUNDLE" -eq 1 ] || { [ "$DESKTOP" -eq 1 ] && [ "$MOCK" -eq 0 ]; }; }; then
  die "--bundle and --desktop start one kiosk — pick it with --kiosk <$(kiosk_ids | tr ' ' '|')> (--desktop --mock opens them all)"
fi
require_node

# Embedded-bundle mode: the bundle's own studio is the process manager — it
# boots on :8080 and starts the kiosk as a hidden worker process, so none of
# the normal studio/build/serve steps below apply.
if [ "$BUNDLE" -eq 1 ]; then
  BUNDLE_DIR="$(kiosk_bundle_dir)"
  [ -f "$BUNDLE_DIR/bundle.env" ] \
    || die "no bundle at $BUNDLE_DIR — build one first: ./setup.sh --bundle"
  # shellcheck disable=SC1091
  . "$BUNDLE_DIR/bundle.env"
  [ -f "$BUNDLE_DIR/studio/frontend/.next/BUILD_ID" ] \
    || die "bundle not set up yet — run: ./setup.sh --bundle  (or: cd $BUNDLE_DIR/studio && ./setup.sh)"

  if [ "$DESKTOP" -eq 1 ]; then
    APP="$(desktop_app_path || true)"
    [ -n "$APP" ] || die "no desktop build found — build one first: ./setup.sh --build"
    info "Launching the desktop shell on the embedded bundle (studio :8080, kiosk :$KIOSK_BUNDLE_PORT)"
    # External-target mode of the shell (electron/main.js): it runs the
    # bundle's start script and opens the window on the kiosk; the studio that
    # runs it stays reachable from the staff menu (F9) and F2.
    export KIOSK_SHELL_KIOSK_URL="${KIOSK_SHELL_KIOSK_URL:-http://127.0.0.1:$KIOSK_BUNDLE_PORT}"
    export KIOSK_SHELL_PLATFORM_URL="${KIOSK_SHELL_PLATFORM_URL:-http://127.0.0.1:8080}"
    export KIOSK_SHELL_URL="${KIOSK_SHELL_URL:-$KIOSK_SHELL_KIOSK_URL}"
    export KIOSK_SHELL_CMD="bash ./start.sh"
    export KIOSK_SHELL_CWD="$BUNDLE_DIR/studio"
    export KIOSK_SHELL_TIMEOUT_SECS="${KIOSK_SHELL_TIMEOUT_SECS:-900}"
    exec "$APP"
  fi

  info "Starting the embedded bundle (studio :8080, kiosk :$KIOSK_BUNDLE_PORT, mode: ${KIOSK_BUNDLE_MODE:-?})"
  cd "$BUNDLE_DIR/studio" || die "cannot enter $BUNDLE_DIR/studio"
  exec bash ./start.sh
fi

# Each kiosk's dependencies, config and port. --port (or PORT) is the first
# kiosk's port and the rest follow it; otherwise every kiosk has its own.
PORT_BASE="${PORT_ARG:-${PORT:-}}"
[ -z "$PORT_BASE" ] || [[ "$PORT_BASE" =~ ^[0-9]+$ ]] || die "--port takes a number, not $PORT_BASE"
PORTS=()
for i in "${!KIOSK_DIRS[@]}"; do
  use_kiosk "${KIOSK_DIRS[$i]}"
  [ "$DESKTOP" -eq 1 ] && continue # the packaged app carries its own server and settings
  ensure_frontend_deps
  ensure_config
  ensure_admin_password
  if [ -n "$PORT_BASE" ]; then port=$((PORT_BASE + i)); else port="$(kiosk_port "$KIOSK_DIR")"; fi
  for taken in ${PORTS[@]+"${PORTS[@]}"}; do
    [ "$taken" != "$port" ] || die "two kiosks want port $port — give them different \"port\" values in kiosk.json, or pass --port"
  done
  PORTS+=("$port")
done
use_kiosk "${KIOSK_DIRS[0]}"

# Several kiosks run together and stop together: each process in its own
# session, its output tagged with the kiosk's id.
SERVERS=() TAGS=()
stop_servers() {
  local pid
  for pid in ${SERVERS[@]+"${SERVERS[@]}"}; do kill -- "-$pid" 2>/dev/null || true; done
  for pid in ${SERVERS[@]+"${SERVERS[@]}"}; do wait "$pid" 2>/dev/null || true; done
}
start_tagged() { # start_tagged <tag> <dir> <command...>
  local tag="$1" dir="$2"
  shift 2
  # shellcheck disable=SC2016
  (cd "$dir" && exec setsid bash -c 'set -o pipefail; "${@:2}" 2>&1 | sed -u "s/^/[$1] /"' _ "$tag" "$@") &
  SERVERS+=("$!")
  TAGS+=("$tag")
}
trap_servers() {
  trap 'echo; info "Stopping the kiosks"; stop_servers; exit 130' INT
  trap 'stop_servers; exit 143' TERM
}

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
  if [ "$MOCK" -eq 1 ]; then VARIANT=mock; else VARIANT=""; fi
  APPS=()
  for dir in "${KIOSK_DIRS[@]}"; do
    use_kiosk "$dir"
    app="$(desktop_app_path ${VARIANT:+"$VARIANT"} || true)"
    [ -n "$app" ] || die "no ${VARIANT:+mocked }desktop build of $(kiosk_label "$dir") — package one first: common/scripts/build.sh${VARIANT:+ --mock} --kiosk $(kiosk_id "$dir")"
    APPS+=("$app")
  done
  if [ "${#APPS[@]}" -eq 1 ]; then
    [ -n "$PORT_ARG" ] && export KIOSK_PORT="$PORT_ARG"
    info "Launching the desktop kiosk: ${APPS[0]}"
    exec "${APPS[0]}"
  fi
  [ -z "$PORT_ARG" ] || die "--port pins one app's port — with several kiosks, leave it out (each app picks a free one)"
  trap_servers
  for i in "${!KIOSK_DIRS[@]}"; do
    info "Launching $(kiosk_label "${KIOSK_DIRS[$i]}"): ${APPS[$i]}"
    start_tagged "$(kiosk_id "${KIOSK_DIRS[$i]}")" "$WORKSPACE_ROOT" "${APPS[$i]}"
  done
  info "Ctrl+C closes every app"
  wait
  exit 0
fi

for i in "${!KIOSK_DIRS[@]}"; do
  use_kiosk "${KIOSK_DIRS[$i]}"
  export PORT="${PORTS[$i]}" # next dev/start listen here; the CMS proxy URL derives from it too
  [ "${#KIOSK_DIRS[@]}" -eq 1 ] || info "Preparing $(kiosk_label "$KIOSK_DIR")"

  # 3. Database priming (first run only) -----------------------------------
  # Payload only creates + seeds the SQLite schema outside production, so a fresh
  # checkout needs one dev boot before `next start` can serve.
  if [ ! -s "$FRONTEND_DIR/db.sqlite" ]; then
    info "No database yet — priming db.sqlite with a one-off dev boot (first run only)"
    rm -f "$KIOSK_DIR/.prime.log"
    # exec keeps $! equal to the new session's id, so the group kill below reaches the dev server.
    (cd "$FRONTEND_DIR" && exec setsid nohup npm run dev >"$KIOSK_DIR/.prime.log" 2>&1) &
    PRIME_PID=$!
    echo "$PRIME_PID" >"$KIOSK_DIR/.prime.pid"
    waited=0
    until [ -s "$FRONTEND_DIR/db.sqlite" ]; do
      curl -s -o /dev/null --max-time 5 "http://localhost:$PORT/admin" || true
      sleep 3
      waited=$((waited + 3))
      if [ "$waited" -ge 240 ]; then
        kill -- "-$PRIME_PID" 2>/dev/null || true
        die "database was not created within 240s — check $KIOSK_DIR/.prime.log"
      fi
    done
    sleep 3 # let seeding finish writing
    kill -- "-$PRIME_PID" 2>/dev/null || true
    for _ in $(seq 1 40); do kill -0 -- "-$PRIME_PID" 2>/dev/null || break; sleep 0.5; done
    wait "$PRIME_PID" 2>/dev/null || true
    rm -f "$KIOSK_DIR/.prime.pid"
    ok "Database created and seeded"
  fi

  # 4. Production build ----------------------------------------------------
  if [ "$REBUILD" -eq 1 ] || [ ! -f "$FRONTEND_DIR/.next/BUILD_ID" ]; then
    info "Building the frontend (production)"
    (cd "$FRONTEND_DIR" && npm run build)
  else
    info "Reusing existing production build (use --rebuild to force a fresh one)"
  fi
done

# 5. Serve ------------------------------------------------------------------
banner() { # banner <port>
  info "Starting $(kiosk_label "$KIOSK_DIR") at http://localhost:$1"
  echo "    kiosk UI      http://localhost:$1"
  echo "    admin (CMS)   http://localhost:$1/admin  ($(kiosk_admin_login))"
  echo "    health        http://localhost:$1/api/health"
  echo
}

# A settings save at /settings restarts the server: scripts/with-kiosk-env.mjs,
# behind `npm run start`, starts it again on exit code 77.
if [ "${#KIOSK_DIRS[@]}" -eq 1 ]; then
  banner "$PORT"
  cd "$FRONTEND_DIR" || die "cannot enter $FRONTEND_DIR"
  exec npm run start
fi

# Several kiosks: one server each (see start_tagged); the first to stop stops them all.
trap_servers
for i in "${!KIOSK_DIRS[@]}"; do
  use_kiosk "${KIOSK_DIRS[$i]}"
  banner "${PORTS[$i]}"
  PORT="${PORTS[$i]}" start_tagged "$(kiosk_id "$KIOSK_DIR")" "$FRONTEND_DIR" npm run start
done
info "Ctrl+C stops every kiosk (the studio keeps running)"

status=0
wait -n -p exited ${SERVERS[@]+"${SERVERS[@]}"} || status=$?
for i in "${!SERVERS[@]}"; do
  [ "${SERVERS[$i]}" != "${exited:-}" ] || warn "the ${TAGS[$i]} kiosk stopped (exit $status) — stopping the others"
done
stop_servers
exit "$status"
