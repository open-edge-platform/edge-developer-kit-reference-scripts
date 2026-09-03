#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# One-time setup for the Vertical Reference Solutions Blueprint.
#
#   ./setup.sh                  install the kiosk frontend's dependencies and set
#                               up the Edge AI Studio prerequisite
#   ./setup.sh --skip-studio    kiosk dependencies only (no studio)
#   ./setup.sh --package-studio also build the distributable studio executable
#   ./setup.sh --hardware       also install the peripheral drivers (NFC, fi-800R scanner, OCR)
#   ./setup.sh --build          kiosk dependencies, then the production build
#                               (scripts/build.sh) — the studio is not set up
#
# See docs/getting-started.md for the full walkthrough.

# shellcheck source=scripts/common.sh disable=SC1091
. "$(cd "$(dirname "$0")" && pwd)/scripts/common.sh"

YES=0 STUDIO="" PACKAGE_STUDIO=0 HARDWARE=0 BUNDLE=0 BUILD=0
BUILD_ARGS=()

usage() {
  cat <<EOF
Usage: ./setup.sh [options] [-- <build args>]

Installs what the kiosk needs: npm dependencies for frontend/, then the Edge AI
Studio prerequisite (the AI gateway) from \$EDGE_AI_STUDIO_DIR — setup fails if
no studio checkout is there. Pass --skip-studio for the kiosk dependencies only
(a terminal that talks to a gateway running elsewhere, or runs with --mock).
The desktop shell (electron/) is not set up here — the build installs its npm
dependencies itself.

Building rather than running natively? ./setup.sh --build installs the kiosk
dependencies and goes straight into scripts/build.sh. The studio checkout must
exist (the build exports the bundle from it) but is not set up — that is only
needed to run the kiosk from this checkout. Add --studio to set it up as well.

Options:
  --yes               non-interactive: assume yes (passes -y to studio system installs)
  --skip-studio       kiosk dependencies only — don't set up the Edge AI Studio
  --studio            accepted for compatibility — setting up the studio (system
                      deps + workers + gateway build) from \$EDGE_AI_STUDIO_DIR
                      (currently: $EDGE_AI_STUDIO_DIR) is now the default
  --node-version <v>  portable Node.js release to fall back on (default $KIOSK_NODE_VERSION)
  --profile <name>    which frontend/configs/<name>.yaml to copy to
                      frontend/config.yaml on a fresh checkout (default
                      $KIOSK_PROFILE; an existing config.yaml is never replaced)
  --package-studio    set up the studio and build its distributable executable
                      (electron package under \$EDGE_AI_STUDIO_DIR/out/)
  --build             after the kiosk dependencies, run the production build
                      (scripts/build.sh: the embedded bundle packaged as a
                      desktop app under build/). Implies --skip-studio unless
                      --studio is also given. Everything after -- goes to the
                      build (see scripts/build.sh --help); --yes is forwarded
  --bundle            embedded-bundle setup: instead of setting up the studio
                      checkout, export a minimal studio with the kiosk injected
                      as a studio sample into build/kiosk-studio/ and install it
                      (run it with ./start.sh --bundle [--desktop]);
                      the kiosk's terminal mode picks the exported services
                      (touch: OCR+face, LLM remote; chat/agent: all five)
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
    --studio) STUDIO=1 ;;
    --skip-studio) STUDIO=0 ;;
    --package-studio) PACKAGE_STUDIO=1; STUDIO=1 ;;
    --hardware) HARDWARE=1 ;;
    --build) BUILD=1 ;;
    --desktop) die "--desktop was removed — the build (scripts/build.sh) installs the electron/ dependencies itself" ;;
    --) shift; BUILD_ARGS=("$@"); break ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "unknown option: $1" ;;
  esac
  shift
done
[ "${#BUILD_ARGS[@]}" -eq 0 ] || [ "$BUILD" -eq 1 ] || die "arguments after -- go to the build — add --build"
[ "$BUILD" -eq 0 ] || [ "$BUNDLE" -eq 0 ] || die "--build (packaged desktop app) and --bundle (bundle installed under build/kiosk-studio) are different outputs — pick one"
# --build only exports from the studio checkout, so it skips the studio's own
# setup unless asked for it explicitly.
if [ -z "$STUDIO" ]; then
  if [ "$BUILD" -eq 1 ]; then STUDIO=0; else STUDIO=1; fi
fi

confirm() { # confirm <question> — true if --yes, or user answers yes on a TTY
  [ "$YES" -eq 1 ] && return 0
  if [ -t 0 ]; then
    read -r -p "$1 [Y/n] " reply
    case "$reply" in n|N|no|NO) return 1 ;; *) return 0 ;; esac
  fi
  return 1 # non-interactive without --yes: skip anything that needs sudo
}

info "Vertical Reference Solutions Blueprint setup"
if [ "$STUDIO" -eq 1 ] || [ "$BUNDLE" -eq 1 ] || [ "$BUILD" -eq 1 ]; then
  studio_present || die "Edge AI Studio not found at $EDGE_AI_STUDIO_DIR
Clone it there, or point EDGE_AI_STUDIO_DIR (env var or .kioskrc) at your checkout,
then re-run ./setup.sh. Setting up the studio needs the checkout, and so do
--bundle and --build (they export the bundle from it). Pass --skip-studio to set
up the kiosk alone (it then runs against a gateway elsewhere, or with ./start.sh --mock)."
fi
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

# 3. Edge AI Studio prerequisite -------------------------------------------
if [ "$BUNDLE" -eq 1 ]; then
  # Embedded-bundle path: the studio checkout is only the export source; the
  # runnable copy (minimal studio + injected kiosk sample) lives in build/.
  if confirm "Install studio system dependencies (runs sudo $EDGE_AI_STUDIO_DIR/install_dependencies.sh)?"; then
    if [ "$YES" -eq 1 ]; then
      (cd "$EDGE_AI_STUDIO_DIR" && sudo ./install_dependencies.sh -y)
    else
      (cd "$EDGE_AI_STUDIO_DIR" && sudo ./install_dependencies.sh)
    fi
  fi
  info "Building and installing the embedded bundle (build/kiosk-studio)"
  "$REPO_ROOT/scripts/bundle.sh" --install
elif [ "$STUDIO" -eq 0 ] && [ "$BUILD" -eq 1 ]; then
  info "Not setting up the Edge AI Studio — the build only exports from its checkout (add --studio to set it up too)"
elif [ "$STUDIO" -eq 0 ]; then
  info "Kiosk dependencies only — not setting up the Edge AI Studio (--skip-studio)"
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

# 4. Production build (--build) ---------------------------------------------
if [ "$BUILD" -eq 1 ]; then
  [ "$YES" -eq 0 ] || BUILD_ARGS=(--yes ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"})
  info "Building the desktop app (scripts/build.sh)"
  "$REPO_ROOT/scripts/build.sh" -- ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"}
fi

# 5. Done -------------------------------------------------------------------
echo
ok "Setup complete."
cat <<EOF

Admin login (Payload CMS at /admin): $(kiosk_admin_login)
EOF
if [ "$BUILD" -eq 1 ]; then
  cat <<EOF

Packages are in build/. Next steps:
  ./start.sh --desktop          launch the packaged app from this checkout
  build/*.deb, *.AppImage       install the .deb on a terminal (sudo dpkg -i), or copy the .AppImage over

Docs: docs/build.md (deploying a terminal, uninstalling)
EOF
else
  cat <<EOF

Next steps:
  ./start.sh                    start the Edge AI Studio and the kiosk (production build)
  ./start.sh --no-studio        kiosk only, against a gateway that is already up
  scripts/dev/dev.sh            start in development mode (hot reload)
  scripts/dev/dev.sh --mock     development with mocked AI — no studio needed
  scripts/build.sh              package the kiosk (embedded bundle desktop app;
                                installs the electron/ deps itself) — or
                                ./setup.sh --build to do setup and build in one go

Docs: README.md and docs/ (getting-started, dev-mode, build, configuration)
EOF
fi
