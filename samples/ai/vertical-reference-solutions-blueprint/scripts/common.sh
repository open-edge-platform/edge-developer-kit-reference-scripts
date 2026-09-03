#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Shared helpers for the vertical-reference-solutions-blueprint launcher scripts (setup/start/dev/build).
# Sourced, not executed.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"
ELECTRON_DIR="$REPO_ROOT/electron"
STUDIO_LOG="$REPO_ROOT/.studio.log"

# Local launcher overrides — a plain shell file at the repo root, gitignored.
if [ -f "$REPO_ROOT/.kioskrc" ]; then
  # shellcheck disable=SC1091
  . "$REPO_ROOT/.kioskrc"
fi

# Edge AI Studio (the AI gateway the kiosk depends on) — all overridable via env
# or .kioskrc; see docs/configuration.md "Launcher script configuration".
EDGE_AI_STUDIO_DIR="${EDGE_AI_STUDIO_DIR:-$(cd "$REPO_ROOT/.." && pwd)/edge-ai-demo-studio}"
STUDIO_AUTOSTART="${STUDIO_AUTOSTART:-1}"
STUDIO_URL="${STUDIO_URL:-http://localhost:8080}"
STUDIO_WAIT_SECS="${STUDIO_WAIT_SECS:-600}"
STUDIO_RUN_MODE="${STUDIO_RUN_MODE:-auto}" # auto | packaged | headless
# Deployment presets for the studio come in two profiles, picked by the
# kiosk's terminal mode (see kiosk_terminal_mode):
#   touch      -> scripts/studio-deployment.touch.json  (OCR, face — LLM is remote,
#                                                        no speech)
#   chat/agent -> scripts/studio-deployment.chat.json   (all five services)
# Set STUDIO_DEPLOYMENT_FILE to force a specific file instead.
STUDIO_DEPLOYMENT_FILE="${STUDIO_DEPLOYMENT_FILE:-}"
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
# Node.js — the machine's, or a portable one unpacked into thirdparty/
# ---------------------------------------------------------------------------
# Mirrors the studio's scripts/bash/setup_thirdparty.sh: ./setup.sh downloads a
# private Node when the machine has none new enough, and every launcher picks it
# up from thirdparty/node afterwards. Overridable via env or .kioskrc.
NODE_MIN_MAJOR=20
KIOSK_NODE_VERSION="${KIOSK_NODE_VERSION:-v22.18.0}"
KIOSK_NODE_DIR="${KIOSK_NODE_DIR:-$REPO_ROOT/thirdparty/node}"
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
  ok "Created frontend/config.yaml from the $profile profile — edit it for this terminal"
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
    || echo "see cms.admin_email / cms.admin_password in frontend/config.yaml"
}

ensure_frontend_deps() {
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    warn "frontend dependencies are missing (did you run ./setup.sh?) — installing now"
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

# The kiosk's terminal mode decides which studio services it needs. Resolution
# mirrors the kiosk's own config precedence: env var, then config.local.yaml,
# then config.yaml, then the touch fallback. The awk below re-parses the YAML
# the app reads through frontend/src/lib/kiosk-config.ts (the source of
# truth) — if the `terminal:` block's shape ever changes, change both.
kiosk_terminal_mode() {
  if [ -n "${NEXT_PUBLIC_KIOSK_MODE:-}" ]; then
    echo "$NEXT_PUBLIC_KIOSK_MODE"
    return 0
  fi
  local f mode
  for f in "$FRONTEND_DIR/config.local.yaml" "$FRONTEND_DIR/config.yaml" \
           "$FRONTEND_DIR/configs/$KIOSK_PROFILE.yaml"; do
    [ -f "$f" ] || continue
    # `mode:` inside the top-level `terminal:` block only (the scanner block
    # has a `mode:` of its own).
    mode="$(awk '
      /^terminal:/ { t = 1; next }
      /^[A-Za-z_]/ { t = 0 }
      t && $1 == "mode:" { gsub(/["'\'']/ , "", $2); print $2; exit }
    ' "$f")"
    if [ -n "$mode" ]; then
      echo "$mode"
      return 0
    fi
  done
  echo "touch"
}

# Which deployment profile applies: an explicit STUDIO_DEPLOYMENT_FILE wins,
# otherwise the kiosk's terminal mode picks it.
studio_deployment_file() {
  if [ -n "$STUDIO_DEPLOYMENT_FILE" ]; then
    echo "$STUDIO_DEPLOYMENT_FILE"
    return 0
  fi
  case "$(kiosk_terminal_mode)" in
    touch) echo "$REPO_ROOT/scripts/studio-deployment.touch.json" ;;
    *) echo "$REPO_ROOT/scripts/studio-deployment.chat.json" ;;
  esac
}

# Install the kiosk's service presets as the studio's deployment.json so the
# services the kiosk needs auto-start with the model/devices the kiosk expects.
# The file is read on every studio boot. Whatever is at the target is replaced
# (the previous file is kept as .bak); set STUDIO_DEPLOYMENT_MANAGE=0 to keep a
# hand-managed deployment.json untouched.
studio_ensure_deployment() {
  [ "$STUDIO_DEPLOYMENT_MANAGE" = "1" ] || return 0
  studio_present || return 0
  local file target
  file="$(studio_deployment_file)"
  [ -f "$file" ] || { warn "deployment template not found: $file"; return 0; }
  target="$EDGE_AI_STUDIO_DIR/deployment.json"

  if [ -f "$target" ] && cmp -s "$target" "$file"; then
    info "Studio deployment.json already matches the $(basename "$file") profile"
    return 0
  fi
  [ -f "$target" ] && cp "$target" "$target.bak"
  cp "$file" "$target"
  ok "Installed $(basename "$file") presets into $target (kiosk mode: $(kiosk_terminal_mode))"
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
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1" || echo 000)"
  [ "$code" != "000" ] && [ "$code" -lt 500 ]
}

studio_check_services() {
  # Touch mode has no speech; chat/agent modes use all five services.
  local mode all_ok=1
  mode="$(kiosk_terminal_mode)"
  svc_up "$STUDIO_URL/api/text-generation/v1/models" || { warn "studio service 'text-generation' (LLM) is not active"; all_ok=0; }
  svc_up "$STUDIO_URL/api/ocr/healthcheck"           || { warn "studio service 'ocr' is not active"; all_ok=0; }
  svc_up "$STUDIO_URL/api/face-recognition/healthcheck" || { warn "studio service 'face-recognition' is not active"; all_ok=0; }
  if [ "$mode" != "touch" ]; then
    svc_up "$STUDIO_URL/api/speech-to-text/healthcheck" || { warn "studio service 'speech-to-text' is not active"; all_ok=0; }
    svc_up "$STUDIO_URL/api/text-to-speech/healthcheck" || { warn "studio service 'text-to-speech' is not active"; all_ok=0; }
  fi
  if [ "$all_ok" -eq 1 ]; then
    ok "All studio AI services required for '$mode' mode are reachable"
  else
    warn "Some AI services are not running. Start them in the studio UI ($STUDIO_URL),"
    warn "or restart the studio so it applies the auto-start presets in"
    warn "$EDGE_AI_STUDIO_DIR/deployment.json (installed from $(studio_deployment_file))."
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
desktop_app_path() {
  local app="" f
  for f in "$ELECTRON_DIR"/out/*.AppImage; do
    [ -f "$f" ] || continue
    if [ -z "$app" ] || [ "$f" -nt "$app" ]; then app="$f"; fi
  done
  if [ -z "$app" ] && [ -x "$ELECTRON_DIR/out/linux-unpacked/kiosk-desktop" ]; then
    app="$ELECTRON_DIR/out/linux-unpacked/kiosk-desktop"
  fi
  [ -n "$app" ] || return 1
  printf '%s\n' "$app"
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
