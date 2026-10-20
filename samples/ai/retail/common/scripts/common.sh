#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Shared helpers for the vertical-reference-solutions-blueprint launcher scripts (setup/start/dev/build).
# Sourced, not executed.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
ELECTRON_DIR="$REPO_ROOT/electron"

# Relative path settings resolve against common/, where .kioskrc lives — never the caller's cwd.
kit_path() {
  case "$1" in
    "" | /*) printf '%s' "$1" ;;
    *) (cd "$REPO_ROOT" && realpath -m -- "$1") ;;
  esac
}
STUDIO_LOG="$REPO_ROOT/.studio.log"

# Local launcher overrides — a plain shell file at the repo root, gitignored.
if [ -f "$REPO_ROOT/.kioskrc" ]; then
  # shellcheck disable=SC1091
  . "$REPO_ROOT/.kioskrc"
fi

# The kiosk the launchers drive: a repo-root folder with kiosk.json and frontend/.
# Each kiosk folder's own launchers pin it; the root launchers pick from the
# selection ./setup.sh saved (resolve_kiosks). Relative values resolve against the repo root.
DEFAULT_KIOSK=public-service-kiosk
KIOSK_SELECTION_FILE="$REPO_ROOT/.kiosks"
if [ -n "${KIOSK_DIR:-}" ]; then KIOSK_PINNED=1; else KIOSK_PINNED=0; fi
KIOSK_DIR="${KIOSK_DIR:-$DEFAULT_KIOSK}"
case "$KIOSK_DIR" in /*) ;; *) KIOSK_DIR="$WORKSPACE_ROOT/$KIOSK_DIR" ;; esac
if [ ! -f "$KIOSK_DIR/kiosk.json" ] || [ ! -f "$KIOSK_DIR/frontend/package.json" ]; then
  echo "error: $KIOSK_DIR is not a kiosk folder (needs kiosk.json and frontend/)" >&2
  exit 1
fi
KIOSK_DIR="$(cd "$KIOSK_DIR" && pwd)"
export KIOSK_DIR
FRONTEND_DIR="$KIOSK_DIR/frontend"
KIOSK_DIRS=("$KIOSK_DIR")
# Packages and embedded bundles of every kiosk, at the repo root.
BUILD_DIR="$WORKSPACE_ROOT/build"

# Edge AI Studio (the AI gateway the kiosk depends on) — all overridable via env
# or .kioskrc; see docs/configuration.md "Launcher script configuration".
EDGE_AI_STUDIO_DIR="$(kit_path "${EDGE_AI_STUDIO_DIR:-$(cd "$REPO_ROOT/../.." && pwd)/edge-ai-demo-studio}")"
STUDIO_AUTOSTART="${STUDIO_AUTOSTART:-1}"
STUDIO_URL="${STUDIO_URL:-http://localhost:8080}"
STUDIO_WAIT_SECS="${STUDIO_WAIT_SECS:-600}"
STUDIO_RUN_MODE="${STUDIO_RUN_MODE:-auto}" # auto | packaged | headless
# Forces one fixed studio deployment.json instead of the kiosks' own (scripts/studio-deployment.mjs).
STUDIO_DEPLOYMENT_FILE="$(kit_path "${STUDIO_DEPLOYMENT_FILE:-}")"
STUDIO_DEPLOYMENT_MANAGE="${STUDIO_DEPLOYMENT_MANAGE:-1}" # 0 = never touch the studio's deployment.json
# frontend/config.yaml is per-install and gitignored: the launchers copy it out
# of frontend/configs/ on the first run. reference | hardware | simulated, or
# any other <name>.yaml in that directory.
KIOSK_PROFILE="${KIOSK_PROFILE:-reference}"

if [ -t 1 ]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  BOLD=""; RED=""; GREEN=""; YELLOW=""; RESET=""
fi

info() { echo "${BOLD}==>${RESET} $*"; }
ok()   { echo "${GREEN} ✓ ${RESET} $*"; }
warn() { echo "${YELLOW}warning:${RESET} $*" >&2; }
die()  { echo "${RED}error:${RESET} $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Kiosk selection
# ---------------------------------------------------------------------------

is_kiosk_dir() { [ -f "$1/kiosk.json" ] && [ -f "$1/frontend/package.json" ]; }

kiosk_value() { # kiosk_value <kiosk dir> <key> — a string field of its kiosk.json
  sed -n "s/^[[:space:]]*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$1/kiosk.json" | head -1
}

kiosk_id() { kiosk_value "$1" id; }

# "Hospital Concierge Kiosk (healthcare)" for messages.
kiosk_label() { echo "$(kiosk_value "$1" title) ($(kiosk_id "$1"))"; }

# Every kiosk folder in the repo, the default one first.
list_kiosks() {
  local dir
  if is_kiosk_dir "$WORKSPACE_ROOT/$DEFAULT_KIOSK"; then echo "$WORKSPACE_ROOT/$DEFAULT_KIOSK"; fi
  for dir in "$WORKSPACE_ROOT"/*/; do
    dir="${dir%/}"
    if [ "$dir" != "$WORKSPACE_ROOT/$DEFAULT_KIOSK" ] && is_kiosk_dir "$dir"; then echo "$dir"; fi
  done
}

kiosk_ids() {
  local dir ids=""
  while IFS= read -r dir; do ids="$ids$(kiosk_id "$dir") "; done < <(list_kiosks)
  printf '%s' "${ids% }"
}

kiosk_by_name() { # kiosk_by_name <kiosk.json id | folder name>
  local dir name="${1%/}"
  while IFS= read -r dir; do
    if [ "$name" = "$(kiosk_id "$dir")" ] || [ "$name" = "${dir##*/}" ]; then
      echo "$dir"
      return 0
    fi
  done < <(list_kiosks)
  return 1
}

select_kiosks() { # select_kiosks <"all" | names, comma/space separated> [where it came from]
  local name dir all=0
  local -A wanted=()
  for name in ${1//,/ }; do
    if [ "$name" = all ]; then all=1; continue; fi
    dir="$(kiosk_by_name "$name")" \
      || die "no such kiosk: $name${2:+ (from $2)} — pick from: $(kiosk_ids | sed 's/ /, /g'), all"
    wanted[$dir]=1
  done
  KIOSK_DIRS=()
  while IFS= read -r dir; do
    if [ "$all" -eq 1 ] || [ -n "${wanted[$dir]-}" ]; then KIOSK_DIRS+=("$dir"); fi
  done < <(list_kiosks)
  [ "${#KIOSK_DIRS[@]}" -gt 0 ] || die "no kiosk selected${2:+ (from $2)}"
}

saved_kiosks() { # the saved selection, space separated; empty when there is none
  [ -f "$KIOSK_SELECTION_FILE" ] || return 0
  sed -e 's/#.*//' "$KIOSK_SELECTION_FILE" | tr -s '\r\n\t ' ' ' | sed -e 's/^ //' -e 's/ $//'
}

selected_kiosk_ids() { # "public-service, healthcare"
  local dir ids=""
  for dir in "${KIOSK_DIRS[@]}"; do ids="$ids${ids:+, }$(kiosk_id "$dir")"; done
  printf '%s' "$ids"
}

save_kiosks() {
  local dir
  for dir in "${KIOSK_DIRS[@]}"; do kiosk_id "$dir"; done >"$KIOSK_SELECTION_FILE"
}

use_kiosk() { # use_kiosk <kiosk dir> — point the helpers, and every child process, at it
  KIOSK_DIR="$1"
  FRONTEND_DIR="$1/frontend"
  export KIOSK_DIR
}

# The kiosks a root launcher drives: --kiosk, else $KIOSKS (env or .kioskrc),
# else the selection ./setup.sh saved, else the default kiosk. A pinned
# KIOSK_DIR (<kiosk>/scripts/*.sh) drives that kiosk alone.
resolve_kiosks() { # resolve_kiosks [--kiosk value]
  if [ "$KIOSK_PINNED" -eq 1 ]; then
    [ -z "${1:-}" ] || die "--kiosk is for the root launchers — ${KIOSK_DIR#"$WORKSPACE_ROOT"/}/'s own scripts always drive that kiosk"
    KIOSK_DIRS=("$KIOSK_DIR")
    return 0
  fi
  if [ -n "${1:-}" ]; then
    select_kiosks "$1" "--kiosk"
  elif [ -n "${KIOSKS:-}" ]; then
    select_kiosks "$KIOSKS" "\$KIOSKS"
  elif [ -n "$(saved_kiosks)" ]; then
    select_kiosks "$(saved_kiosks)" "${KIOSK_SELECTION_FILE#"$WORKSPACE_ROOT"/}"
  else
    select_kiosks "$DEFAULT_KIOSK"
  fi
  use_kiosk "${KIOSK_DIRS[0]}"
}

# The port a kiosk serves on from this checkout: kiosk.json "port", else 3000. Needs node.
kiosk_port() {
  node -e 'process.stdout.write(String(require(process.argv[1]).port ?? 3000))' "$1/kiosk.json"
}

# Where scripts/bundle.mjs exports the current kiosk's embedded bundle.
kiosk_bundle_dir() {
  kit_path "${KIOSK_BUNDLE_DIR:-$BUILD_DIR/kiosk-studio/$(kiosk_id "$KIOSK_DIR")}"
}

# ---------------------------------------------------------------------------
# Node.js — the machine's, or a portable one unpacked into thirdparty/
# ---------------------------------------------------------------------------
# Mirrors the studio's scripts/bash/setup_thirdparty.sh: ./setup.sh downloads a
# private Node when the machine has none new enough, and every launcher picks it
# up from thirdparty/node afterwards. Overridable via env or .kioskrc.
NODE_MIN_MAJOR=20
KIOSK_NODE_VERSION="${KIOSK_NODE_VERSION:-v22.18.0}"
KIOSK_NODE_DIR="$(kit_path "${KIOSK_NODE_DIR:-$REPO_ROOT/thirdparty/node}")"
KIOSK_NODE_MIRROR="${KIOSK_NODE_MIRROR:-https://nodejs.org/dist}"

node_usable() {
  command -v node >/dev/null 2>&1 || return 1
  local major
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$major" -ge "$NODE_MIN_MAJOR" ]
}

# Put an already-downloaded portable Node first on PATH (npm ships beside it).
adopt_portable_node() {
  [ -x "$KIOSK_NODE_DIR/bin/node" ] || return 1
  case ":$PATH:" in
    *":$KIOSK_NODE_DIR/bin:"*) ;;
    *) PATH="$KIOSK_NODE_DIR/bin:$PATH"; export PATH ;;
  esac
}

node_platform() {
  local os arch
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) return 1 ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) return 1 ;;
  esac
  echo "$os-$arch"
}

fetch_file() { # fetch_file <url> <destination>
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1"
  else
    die "neither curl nor wget is available to download $1"
  fi
}

verify_sha256() { # verify_sha256 <file> <SHASUMS256.txt>
  local name expected actual
  name="$(basename "$1")"
  expected="$(awk -v f="$name" '$2 == f || $2 == "./"f { print $1; exit }' "$2")"
  [ -n "$expected" ] || die "no checksum for $name in SHASUMS256.txt"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$1" | cut -d' ' -f1)"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$1" | cut -d' ' -f1)"
  else
    warn "no sha256sum/shasum on this machine — skipping the Node.js checksum check"
    return 0
  fi
  [ "$actual" = "$expected" ] || die "checksum mismatch for $name (expected $expected, got $actual)"
}

install_portable_node() {
  local platform archive url tmp
  platform="$(node_platform)" \
    || die "no portable Node.js build for $(uname -s)/$(uname -m) — install Node.js $NODE_MIN_MAJOR or newer yourself (https://nodejs.org)."
  archive="node-$KIOSK_NODE_VERSION-$platform.tar.xz"
  url="$KIOSK_NODE_MIRROR/$KIOSK_NODE_VERSION/$archive"

  info "No usable Node.js found — downloading a portable one ($KIOSK_NODE_VERSION, $platform)"
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN
  fetch_file "$url" "$tmp/$archive" || die "could not download $url"
  fetch_file "$KIOSK_NODE_MIRROR/$KIOSK_NODE_VERSION/SHASUMS256.txt" "$tmp/SHASUMS256.txt" \
    || die "could not download the Node.js checksums"
  verify_sha256 "$tmp/$archive" "$tmp/SHASUMS256.txt"

  rm -rf "$KIOSK_NODE_DIR"
  mkdir -p "$KIOSK_NODE_DIR"
  tar -xJf "$tmp/$archive" -C "$KIOSK_NODE_DIR" --strip-components=1 \
    || die "could not extract $archive"

  adopt_portable_node || die "no node binary under $KIOSK_NODE_DIR after extraction"
  node_usable || die "the downloaded Node.js does not run on this machine"
  ok "Portable Node $(node -v) installed at $KIOSK_NODE_DIR"
}

# Strict check for the scripts that only run the kit (start/dev/build).
require_node() {
  node_usable && return 0
  adopt_portable_node && node_usable && return 0
  if command -v node >/dev/null 2>&1; then
    die "Node.js >= $NODE_MIN_MAJOR is required — found $(node -v). Next.js needs $NODE_MIN_MAJOR+, and it is also the runtime the desktop bundle ships.
Run ./setup.sh to unpack a portable one into thirdparty/node, or upgrade yours (https://nodejs.org)."
  fi
  die "node is not on PATH. Run ./setup.sh to unpack a portable one into thirdparty/node, or install Node.js $NODE_MIN_MAJOR or newer (https://nodejs.org)."
}

# Setup's variant: download a portable Node instead of refusing to continue.
ensure_node() {
  node_usable && return 0
  adopt_portable_node && node_usable && return 0
  install_portable_node
}

list_profiles() {
  local path name names=""
  for path in "$FRONTEND_DIR"/configs/*.yaml; do
    [ -f "$path" ] || continue
    name="${path##*/}"
    names="$names${name%.yaml} "
  done
  printf '%s' "$names"
}

# Materialise frontend/config.yaml from a committed profile. An existing one is
# never overwritten — it is the terminal's own settings.
ensure_config() { # ensure_config [profile]
  local profile source
  profile="${1:-$KIOSK_PROFILE}"
  [ -f "$FRONTEND_DIR/config.yaml" ] && return 0
  source="$FRONTEND_DIR/configs/$profile.yaml"
  [ -f "$source" ] \
    || die "no such profile: $profile (looked for $source; try: $(list_profiles))"
  cp "$source" "$FRONTEND_DIR/config.yaml"
  ok "Created ${FRONTEND_DIR#"$WORKSPACE_ROOT"/}/config.yaml from the $profile profile — edit it for this terminal"
}

# The Payload admin password: config.yaml arrives without one, and the first
# setup/start fills it with a crypto-random value
# (scripts/ensure-admin-password.mjs). Needs node — call after require_node.
ensure_admin_password() {
  node "$REPO_ROOT/scripts/ensure-admin-password.mjs" "$@"
}

# "<email> / <password>" for the launcher banners.
kiosk_admin_login() {
  node "$REPO_ROOT/scripts/ensure-admin-password.mjs" --print 2>/dev/null \
    || echo "see cms.admin_email / cms.admin_password in ${FRONTEND_DIR#"$WORKSPACE_ROOT"/}/config.yaml"
}

frontend_deps_present() {
  node -e "for (const p of ['next','yaml','payload']) require.resolve(p, { paths: [process.argv[1]] })" \
    "$FRONTEND_DIR" >/dev/null 2>&1
}

ensure_frontend_deps() {
  if ! frontend_deps_present; then
    warn "the kiosk's dependencies are missing (did you run ./setup.sh?) — installing now"
    (cd "$FRONTEND_DIR" && npm install)
  fi
}

# ---------------------------------------------------------------------------
# Edge AI Studio helpers
# ---------------------------------------------------------------------------

studio_present() { [ -d "$EDGE_AI_STUDIO_DIR" ]; }

# Gateway liveness: /api/services is the studio's own readiness endpoint.
studio_up() { curl -sf -o /dev/null --max-time 5 "$STUDIO_URL/api/services"; }

studio_packaged_bin() {
  local bin="$EDGE_AI_STUDIO_DIR/out/EdgeAIDemoStudio/EdgeAIDemoStudio"
  if [ -x "$bin" ]; then echo "$bin"; return 0; fi
  return 1
}

studio_deployment() { # studio_deployment install <studio dir> | services — for every selected kiosk
  require_node
  node "$REPO_ROOT/scripts/studio-deployment.mjs" "$1" --profile "$KIOSK_PROFILE" \
    --file "$STUDIO_DEPLOYMENT_FILE" "${@:2}" "${KIOSK_DIRS[@]}"
}

studio_ensure_deployment() {
  [ "$STUDIO_DEPLOYMENT_MANAGE" = "1" ] || return 0
  studio_present || return 0
  studio_deployment install "$EDGE_AI_STUDIO_DIR" || exit 1
}

studio_start() {
  studio_present || die "Edge AI Studio not found at $EDGE_AI_STUDIO_DIR
Set EDGE_AI_STUDIO_DIR (env var or .kioskrc) to your checkout, or pass --no-studio
(the kiosk then serves against whatever gateway is live) / --mock."

  studio_ensure_deployment

  local bin=""
  case "$STUDIO_RUN_MODE" in
    packaged)
      bin="$(studio_packaged_bin)" \
        || die "No packaged studio executable under $EDGE_AI_STUDIO_DIR/out — build it with: (cd \$EDGE_AI_STUDIO_DIR && ./scripts/bash/package.sh)" ;;
    auto)
      bin="$(studio_packaged_bin || true)" ;;
    headless)
      bin="" ;;
    *)
      die "STUDIO_RUN_MODE must be auto, packaged, or headless (got: $STUDIO_RUN_MODE)" ;;
  esac

  if [ -n "$bin" ]; then
    info "Starting Edge AI Studio (packaged app): $bin"
    (cd "$(dirname "$bin")" && nohup "$bin" >>"$STUDIO_LOG" 2>&1 &)
  else
    [ -x "$EDGE_AI_STUDIO_DIR/start.sh" ] \
      || die "$EDGE_AI_STUDIO_DIR/start.sh not found or not executable — is EDGE_AI_STUDIO_DIR pointing at the studio checkout?"
    info "Starting Edge AI Studio (headless server) from $EDGE_AI_STUDIO_DIR"
    (cd "$EDGE_AI_STUDIO_DIR" && nohup ./start.sh >>"$STUDIO_LOG" 2>&1 &)
  fi
  info "Studio output: $STUDIO_LOG"
}

studio_wait() {
  info "Waiting for the studio gateway at $STUDIO_URL (up to ${STUDIO_WAIT_SECS}s — the first launch loads AI models and is slow)"
  local waited=0
  until studio_up; do
    sleep 5
    waited=$((waited + 5))
    if [ "$waited" -ge "$STUDIO_WAIT_SECS" ]; then
      die "Studio gateway did not come up within ${STUDIO_WAIT_SECS}s — check $STUDIO_LOG"
    fi
  done
  ok "Studio gateway is up at $STUDIO_URL"
}

# The kiosk's health semantics: any HTTP reply < 500 counts as up (the gateway
# answers 500 for an inactive service, 404 for a path a live worker doesn't serve).
svc_up() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1")" || true
  [ "$code" != "000" ] && [ "$code" -lt 500 ]
}

studio_check_services() {
  local services service url all_ok=1
  services="$(studio_deployment services)" || exit 1
  for service in $services; do
    case "$service" in
      text-generation) url="$STUDIO_URL/api/text-generation@text-generation/v1/models" ;;
      *) url="$STUDIO_URL/api/$service@$service/healthcheck" ;;
    esac
    svc_up "$url" || { warn "studio service '$service' is not active"; all_ok=0; }
  done
  if [ "$all_ok" -eq 1 ]; then
    ok "All studio AI services the kiosks' deployment.json runs are reachable"
  else
    warn "Some AI services are not running. Start them in the studio UI ($STUDIO_URL),"
    warn "or restart the studio so it applies the auto-start presets in"
    warn "$EDGE_AI_STUDIO_DIR/deployment.json."
    warn "LLM + OCR down is fatal for document flows unless you run with --mock."
  fi
  return 0
}

# Start the studio if it isn't already running, then verify its services.
ensure_studio() {
  if studio_up; then
    ok "Edge AI Studio gateway already running at $STUDIO_URL"
    studio_ensure_deployment # presets apply on the studio's next restart
  else
    studio_start
    studio_wait
  fi
  studio_check_services
}

# The packaged desktop app: newest .AppImage from the shell's build output,
# else the unpacked shell (--shell-only). Non-zero if neither exists.
desktop_app_path() { # desktop_app_path [mock] — the current kiosk's newest packaged app, or its mocked build
  local app="" f product binary
  product="$(kiosk_value "$KIOSK_DIR" productName)"
  binary="$(kiosk_value "$KIOSK_DIR" executableName)"
  for f in "$BUILD_DIR/$product"-*.AppImage; do
    [ -f "$f" ] || continue
    case "$f" in
      *-mock.AppImage) [ "${1:-}" = mock ] || continue ;;
      *) [ -z "${1:-}" ] || continue ;;
    esac
    if [ -z "$app" ] || [ "$f" -nt "$app" ]; then app="$f"; fi
  done
  if [ -z "$app" ] && [ -z "${1:-}" ] && [ -x "$ELECTRON_DIR/out/linux-unpacked/$binary" ]; then
    app="$ELECTRON_DIR/out/linux-unpacked/$binary"
  fi
  [ -n "$app" ] || return 1
  printf '%s\n' "$app"
}

# The build's questions for the current kiosk, answered now: prints the full
# argument list for its build, one per line, so the build has nothing left to ask.
# The first argument is the flow: --bundle-app, or --mock for the kiosk alone.
build_answers() {
  node "$ELECTRON_DIR/scripts/build.mjs" --ask-only "$@"
}

export_mock_env() {
  # Zero-dependency demo mode: no AI gateway, no verification gate. The
  # gateway URLs are blanked so those services count as intentionally "off" —
  # a *configured but unreachable* service would fail /api/health and put the
  # kiosk out of service.
  export KIOSK_LLM_MOCK=true
  export KIOSK_REQUIRE_DOCUMENT_VERIFICATION=false
  export KIOSK_OCR_BASE_URL=""
  export KIOSK_FACE_BASE_URL=""
  export KIOSK_STT_BASE_URL=""
  export KIOSK_TTS_BASE_URL=""
  # The production config.yaml is strict about hardware and face matching
  # (face.require_match: true, nfc/scanner simulate: never) — right for a real
  # terminal, fatal without one: health fail-closes on the missing face
  # service and the identity step refuses to stand a citizen in. Env beats
  # config.yaml, so relax exactly those three here; "auto" still uses a real
  # reader/scanner when one is attached.
  export KIOSK_FACE_REQUIRE_MATCH=false
  export KIOSK_NFC_SIMULATE=auto
  export KIOSK_SCANNER_SIMULATE=auto
  info "Mock mode: LLM mocked, document verification off, gateway services disabled, hardware simulated"
}
