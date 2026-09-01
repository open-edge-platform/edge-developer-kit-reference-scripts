#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# One-time setup for the Vertical Reference Blueprint.
#
#   ./setup.sh                  install kiosk deps + set up the Edge AI Studio prerequisite
#   ./setup.sh --package-studio also build the distributable studio executable
#   ./setup.sh --desktop        also install the Tauri (desktop bundle) toolchain
#   ./setup.sh --hardware       also install the peripheral drivers (NFC, fi-800R scanner, OCR)
#
# See docs/getting-started.md for the full walkthrough.

# shellcheck source=scripts/common.sh disable=SC1091
. "$(cd "$(dirname "$0")" && pwd)/scripts/common.sh"

YES=0 SKIP_STUDIO=0 PACKAGE_STUDIO=0 DESKTOP=0 HARDWARE=0 BUNDLE=0

usage() {
  cat <<EOF
Usage: ./setup.sh [options]

Installs everything the blueprint needs to run:
  1. npm dependencies for frontend/ and tauri/
  2. the Edge AI Studio prerequisite (system deps + workers + gateway build)
     from \$EDGE_AI_STUDIO_DIR (currently: $EDGE_AI_STUDIO_DIR)

Options:
  --yes               non-interactive: assume yes (passes -y to studio system installs)
  --node-version <v>  portable Node.js release to fall back on (default $KIOSK_NODE_VERSION)
  --profile <name>    which frontend/configs/<name>.yaml to copy to
                      frontend/config.yaml on a fresh checkout (default
                      $KIOSK_PROFILE; an existing config.yaml is never replaced)
  --skip-studio       do not set up the Edge AI Studio
  --package-studio    additionally build the studio's distributable executable
                      (electron package under \$EDGE_AI_STUDIO_DIR/out/)
  --bundle            embedded-bundle setup: instead of setting up the studio
                      checkout, export a minimal studio with the kiosk injected
                      as a studio sample into build/kiosk-studio/ and install it
                      (run it with ./start.sh --bundle [--tauri]);
                      the kiosk's terminal mode picks the exported services
                      (touch: LLM+OCR+face; chat/agent: all five)
  --desktop           install the desktop-bundle toolchain (Rust, WebKitGTK dev
                      packages — Debian/Ubuntu, uses sudo)
  --hardware          install the peripheral drivers via
                      frontend/scripts/install-drivers.sh: pcscd (NFC reader),
                      sane-utils + the PFU pfufs backend (fi-800R scanner),
                      poppler-utils (OCR rasterizer) — uses sudo
  -h, --help          this help

Studio location is configurable: EDGE_AI_STUDIO_DIR env var or .kioskrc file.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1 ;;
    --node-version) shift; KIOSK_NODE_VERSION="${1:-}"; [ -n "$KIOSK_NODE_VERSION" ] || die "--node-version needs a value" ;;
    --profile) shift; KIOSK_PROFILE="${1:-}"; [ -n "$KIOSK_PROFILE" ] || die "--profile needs a value" ;;
    --bundle) BUNDLE=1 ;;
    --skip-studio) SKIP_STUDIO=1 ;;
    --package-studio) PACKAGE_STUDIO=1 ;;
    --desktop) DESKTOP=1 ;;
    --hardware) HARDWARE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "unknown option: $1" ;;
  esac
  shift
done

confirm() { # confirm <question> — true if --yes, or user answers yes on a TTY
  [ "$YES" -eq 1 ] && return 0
  if [ -t 0 ]; then
    read -r -p "$1 [Y/n] " reply
    case "$reply" in n|N|no|NO) return 1 ;; *) return 0 ;; esac
  fi
  return 1 # non-interactive without --yes: skip anything that needs sudo
}

info "Vertical Reference Blueprint setup"
# Downloads a portable Node into thirdparty/node when the machine has none
# new enough; every other launcher picks it up from there.
ensure_node
ok "Node $(node -v), npm $(npm -v)"

# This terminal's own config.yaml (gitignored), then its CMS credentials.
ensure_config
ensure_admin_password

# 1. Kiosk npm dependencies -------------------------------------------------
info "Installing frontend dependencies (frontend/)"
(cd "$FRONTEND_DIR" && npm install)

info "Installing desktop-shell dependencies (tauri/)"
(cd "$TAURI_DIR" && npm install)

# 2. Optional system packages ----------------------------------------------
if [ "$HARDWARE" -eq 1 ]; then
  info "Installing peripheral drivers (frontend/scripts/install-drivers.sh, uses sudo)"
  if [ "$YES" -eq 1 ]; then
    "$FRONTEND_DIR/scripts/install-drivers.sh" --yes
  else
    "$FRONTEND_DIR/scripts/install-drivers.sh"
  fi
else
  command -v pdftoppm >/dev/null 2>&1 \
    || warn "pdftoppm (poppler-utils) is missing — live OCR of PDFs will fail. Re-run with --hardware to install."
fi

if [ "$DESKTOP" -eq 1 ]; then
  info "Installing desktop-bundle toolchain (tauri/scripts/setup-linux.sh, uses sudo)"
  "$TAURI_DIR/scripts/setup-linux.sh"
fi

# 3. Edge AI Studio prerequisite -------------------------------------------
if [ "$BUNDLE" -eq 1 ]; then
  # Embedded-bundle path: the studio checkout is only the export source; the
  # runnable copy (minimal studio + injected kiosk sample) lives in build/.
  studio_present || die "Edge AI Studio not found at $EDGE_AI_STUDIO_DIR — the bundle is exported from it (set EDGE_AI_STUDIO_DIR)"
  if confirm "Install studio system dependencies (runs sudo $EDGE_AI_STUDIO_DIR/install_dependencies.sh)?"; then
    if [ "$YES" -eq 1 ]; then
      (cd "$EDGE_AI_STUDIO_DIR" && sudo ./install_dependencies.sh -y)
    else
      (cd "$EDGE_AI_STUDIO_DIR" && sudo ./install_dependencies.sh)
    fi
  fi
  info "Building and installing the embedded bundle (build/kiosk-studio)"
  "$REPO_ROOT/scripts/bundle.sh" --install
elif [ "$SKIP_STUDIO" -eq 1 ]; then
  info "Skipping Edge AI Studio setup (--skip-studio)"
elif ! studio_present; then
  warn "Edge AI Studio not found at $EDGE_AI_STUDIO_DIR"
  warn "Clone it there, or point EDGE_AI_STUDIO_DIR (env var or .kioskrc) at your checkout,"
  warn "then re-run ./setup.sh. Without it the kiosk runs in --mock mode only."
else
  info "Setting up Edge AI Studio at $EDGE_AI_STUDIO_DIR"
  if confirm "Install studio system dependencies (runs sudo $EDGE_AI_STUDIO_DIR/install_dependencies.sh)?"; then
    if [ "$YES" -eq 1 ]; then
      (cd "$EDGE_AI_STUDIO_DIR" && sudo ./install_dependencies.sh -y)
    else
      (cd "$EDGE_AI_STUDIO_DIR" && sudo ./install_dependencies.sh)
    fi
  else
    warn "Skipped studio system dependencies — its setup may fail if they are missing."
  fi

  info "Running the studio's own setup (thirdparty runtimes, AI workers, gateway build) — this can take a while"
  (cd "$EDGE_AI_STUDIO_DIR" && ./setup.sh)
  ok "Edge AI Studio is set up"

  # Preset the five services the kiosk needs (LLM, OCR, face, STT, TTS) to
  # auto-start with the model the kiosk's config.yaml expects.
  studio_ensure_deployment

  if [ "$PACKAGE_STUDIO" -eq 1 ]; then
    info "Packaging the studio executable ($EDGE_AI_STUDIO_DIR/scripts/bash/package.sh)"
    (cd "$EDGE_AI_STUDIO_DIR" && ./scripts/bash/package.sh)
    ok "Studio executable: $EDGE_AI_STUDIO_DIR/out/EdgeAIDemoStudio/EdgeAIDemoStudio"
  fi
fi

# 4. Done -------------------------------------------------------------------
echo
ok "Setup complete."
cat <<EOF

Admin login (Payload CMS at /admin): $(kiosk_admin_login)

Next steps:
  ./start.sh          start the kiosk (production build, studio auto-started)
  scripts/dev/dev.sh            start in development mode (hot reload)
  scripts/dev/dev.sh --mock     development with mocked AI — no studio needed
  ./build.sh          package the kiosk (embedded bundle desktop app)

Docs: README.md and docs/ (getting-started, dev-mode, build, configuration)
EOF
