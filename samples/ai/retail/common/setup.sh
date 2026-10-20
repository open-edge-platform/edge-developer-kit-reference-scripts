#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# One-time setup for the Vertical Reference Solutions Blueprint.
#
#   ./setup.sh                  ask what to do (set up only, start, dev or build),
#                               which kiosks and where the AI comes from, install
#                               their dependencies and the Edge AI Studio prerequisite
#   ./setup.sh --start          set up, then start the kiosks (./start.sh)
#   ./setup.sh --dev            set up, then run one kiosk in dev mode (scripts/dev/dev.sh)
#   ./setup.sh --kiosk all      every kiosk, no question (or: public-service, healthcare)
#   ./setup.sh --skip-studio    kiosk dependencies only (no studio)
#   ./setup.sh --package-studio also build the distributable studio executable
#   ./setup.sh --hardware       also install the peripheral drivers (NFC, fi-800R scanner, OCR)
#   ./setup.sh --build          kiosk dependencies, then the production build
#                               (scripts/build.sh) — the studio is not set up
#   ./setup.sh --mock           no studio at all: kiosk dependencies only, for
#                               ./start.sh --mock; with --build, the mocked
#                               desktop apps (./start.sh --desktop --mock)
#
# Every question — setup's own and the build's (kiosk mode, window, package
# format) — is asked up front; the installs and the build run unattended after.
#
# See docs/getting-started.md for the full walkthrough.

# shellcheck source=scripts/common.sh disable=SC1091
. "$(cd "$(dirname "$0")" && pwd)/scripts/common.sh"

YES=0 STUDIO="" PACKAGE_STUDIO=0 HARDWARE=0 BUNDLE=0 BUILD=0 MOCK=0 KIOSK_ARG="" THEN=""
BUILD_ARGS=()

usage() {
  cat <<EOF
Usage: ./setup.sh [options] [-- <build args>]

On a terminal, setup first asks what to do — set up only, set up and start,
set up and run one kiosk in dev mode, or set up and build — then which kiosks
and whether the AI comes from the Edge AI Studio or is mocked. Flags answer
up front: --start, --dev, --build; --kiosk; --mock.

Installs what the chosen kiosks ($(kiosk_ids | sed 's/ /, /g'), or all) need:
each one's frontend dependencies (<kiosk>/frontend/), then the Edge AI
Studio prerequisite (the AI gateway, shared by every kiosk) from
\$EDGE_AI_STUDIO_DIR — setup fails if no studio checkout is there. Pass
--skip-studio for the kiosk dependencies only (a terminal that talks to a
gateway running elsewhere, or runs with --mock).
The choice is saved, and ./start.sh and ./uninstall.sh follow it.
The desktop shell (electron/) is not set up here — the build installs its npm
dependencies itself.

Building rather than running natively? ./setup.sh --build installs the kiosk
dependencies and goes straight into scripts/build.sh. The studio checkout must
exist (the build exports the bundle from it) but is not set up — that is only
needed to run the kiosk from this checkout. Add --studio to set it up as well.

No studio at all? ./setup.sh --mock installs the kiosk dependencies only, for
./start.sh --mock; ./setup.sh --build --mock also packages each kiosk as a
desktop app with its AI mocked, for ./start.sh --desktop --mock.

Questions come first: whatever setup has to ask (the studio's system packages)
and the build's install settings (kiosk mode, window, package format) are
answered before the first npm install — after that, everything runs unattended.

Options:
  --kiosk <names>     which kiosks, without asking: $(kiosk_ids | sed 's/ /, /g') or all,
                      comma separated (default: the saved choice, else
                      $(kiosk_id "$WORKSPACE_ROOT/$DEFAULT_KIOSK")). <kiosk>/scripts/setup.sh sets up that kiosk alone
  --yes               non-interactive: assume yes (passes -y to studio system installs)
  --skip-studio       kiosk dependencies only — don't set up the Edge AI Studio
  --mock              no studio anywhere: --skip-studio, and with --build the
                      kiosk alone is packaged, AI mocked and hardware simulated
                      (scripts/build.sh --mock) — no studio checkout needed
  --studio            accepted for compatibility — setting up the studio (system
                      deps + workers + gateway build) from \$EDGE_AI_STUDIO_DIR
                      (currently: $EDGE_AI_STUDIO_DIR) is now the default
  --node-version <v>  portable Node.js release to fall back on (default $KIOSK_NODE_VERSION)
  --profile <name>    which frontend/configs/<name>.yaml to copy to
                      frontend/config.yaml on a fresh checkout (default
                      $KIOSK_PROFILE; an existing config.yaml is never replaced)
  --package-studio    set up the studio and build its distributable executable
                      (electron package under \$EDGE_AI_STUDIO_DIR/out/)
  --start             after setup, start the kiosks (./start.sh; with --mock,
                      ./start.sh --mock)
  --dev               after setup, run one kiosk in development mode
                      (scripts/dev/dev.sh, hot reload; with --mock, no studio) —
                      with several kiosks, asks which (or pass --kiosk <name>)
  --build             after the kiosk dependencies, run the production build
                      (scripts/build.sh: the embedded bundle packaged as a
                      desktop app per kiosk under build/). Implies --skip-studio unless
                      --studio is also given. Everything after -- goes to the
                      build (see scripts/build.sh --help); --yes is forwarded
  --bundle            embedded-bundle setup: instead of setting up the studio
                      checkout, export a minimal studio with the kiosk injected
                      as a studio sample into build/kiosk-studio/<kiosk>/ and install it
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
    --kiosk) shift; KIOSK_ARG="${1:-}"; [ -n "$KIOSK_ARG" ] || die "--kiosk needs a value" ;;
    --node-version) shift; KIOSK_NODE_VERSION="${1:-}"; [ -n "$KIOSK_NODE_VERSION" ] || die "--node-version needs a value" ;;
    --profile) shift; KIOSK_PROFILE="${1:-}"; [ -n "$KIOSK_PROFILE" ] || die "--profile needs a value" ;;
    --bundle) BUNDLE=1 ;;
    --studio) STUDIO=1 ;;
    --skip-studio) STUDIO=0 ;;
    --mock) MOCK=1 ;;
    --package-studio) PACKAGE_STUDIO=1; STUDIO=1 ;;
    --hardware) HARDWARE=1 ;;
    --build) BUILD=1 ;;
    --start) THEN=start ;;
    --dev) THEN=dev ;;
    --desktop) die "--desktop was removed — the build (scripts/build.sh) installs the electron/ dependencies itself" ;;
    --) shift; BUILD_ARGS=("$@"); break ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "unknown option: $1" ;;
  esac
  shift
done
[ "${#BUILD_ARGS[@]}" -eq 0 ] || [ "$BUILD" -eq 1 ] || die "arguments after -- go to the build — add --build"
[ "$BUILD" -eq 0 ] || [ "$BUNDLE" -eq 0 ] || die "--build (packaged desktop app) and --bundle (bundle installed under build/kiosk-studio/<kiosk>) are different outputs — pick one"
[ -z "$THEN" ] || { [ "$BUILD" -eq 0 ] && [ "$BUNDLE" -eq 0 ]; } || die "--$THEN runs the kiosks from this checkout — it does not combine with --build or --bundle"
if [ "$MOCK" -eq 1 ]; then
  { [ "$BUNDLE" -eq 0 ] && [ "${STUDIO:-0}" -eq 0 ]; } || die "--mock runs without the studio — it does not combine with --studio, --package-studio or --bundle"
  STUDIO=0
fi

confirm() { # confirm <question> — true if --yes, or user answers yes on a TTY
  [ "$YES" -eq 1 ] && return 0
  if [ -t 0 ]; then
    read -r -p "$1 [Y/n] " reply
    case "$reply" in n|N|no|NO) return 1 ;; *) return 0 ;; esac
  fi
  return 1 # non-interactive without --yes: skip anything that needs sudo
}

# The studio's install_dependencies.sh: --yes runs it with -y.
install_studio_deps() {
  if [ "$YES" -eq 1 ]; then
    (cd "$EDGE_AI_STUDIO_DIR" && sudo ./install_dependencies.sh -y)
  else
    (cd "$EDGE_AI_STUDIO_DIR" && sudo ./install_dependencies.sh)
  fi
}

# The kiosk question: numbers, ids or "all"; Enter keeps the current choice.
ask_kiosks() {
  local dirs=() dir i reply token picked bad current=""
  mapfile -t dirs < <(list_kiosks)
  [ "${#dirs[@]}" -gt 1 ] || return 0
  if [ "${#KIOSK_DIRS[@]}" -eq "${#dirs[@]}" ]; then
    current=all
  else
    for dir in "${KIOSK_DIRS[@]}"; do current="$current${current:+,}$(kiosk_id "$dir")"; done
  fi
  echo
  echo "Which kiosks should this checkout run?"
  for i in "${!dirs[@]}"; do
    printf '  %d) %-16s %s\n' "$((i + 1))" "$(kiosk_id "${dirs[$i]}")" "$(kiosk_value "${dirs[$i]}" title)"
  done
  printf '  %d) %-16s %s\n' "$((${#dirs[@]} + 1))" all "all of the above"
  while :; do
    read -r -p "Pick one or more, e.g. 1 or 1,2 [$current] " reply || die "no answer"
    picked="" bad=""
    for token in ${reply//,/ }; do
      if [[ "$token" =~ ^[0-9]+$ ]] && [ "$token" -ge 1 ] && [ "$token" -le "${#dirs[@]}" ]; then
        picked="$picked $(kiosk_id "${dirs[$((token - 1))]}")"
      elif [ "$token" = all ] || [ "$token" = "$((${#dirs[@]} + 1))" ]; then
        picked="$picked all"
      elif kiosk_by_name "$token" >/dev/null; then
        picked="$picked $token"
      else
        bad="$token"
        break
      fi
    done
    [ -n "$bad" ] || break
    warn "not one of the choices: $bad"
  done
  [ -z "$picked" ] || select_kiosks "$picked"
}

# choose <question> <default> <name> <description> [<name> <description>]...
# Sets CHOICE to the picked name; takes its number or the name.
choose() {
  local question="$1" default="$2" names=() i reply
  shift 2
  echo
  echo "$question"
  while [ $# -gt 0 ]; do
    names+=("$1")
    printf '  %d) %-16s %s\n' "${#names[@]}" "$1" "$2"
    shift 2
  done
  while :; do
    read -r -p "Pick one [$default] " reply || die "no answer"
    reply="${reply:-$default}"
    for i in "${!names[@]}"; do
      if [ "$reply" = "$((i + 1))" ] || [ "$reply" = "${names[$i]}" ]; then
        CHOICE="${names[$i]}"
        return 0
      fi
    done
    warn "not one of the choices: $reply"
  done
}

ask_action() {
  choose "What would you like to do?" setup \
    setup "set up only — start, develop or build later" \
    start "set up, then start serving (production build), as start.sh does" \
    dev "set up, then run one kiosk in development mode (hot reload)" \
    build "set up, then package desktop apps into build/"
  case "$CHOICE" in
    start | dev) THEN="$CHOICE" ;;
    build) BUILD=1 ;;
  esac
}

ask_dev_kiosk() {
  local dir options=()
  for dir in "${KIOSK_DIRS[@]}"; do options+=("$(kiosk_id "$dir")" "$(kiosk_value "$dir" title)"); done
  choose "Development mode runs one kiosk at a time — which one?" "$(kiosk_id "${KIOSK_DIRS[0]}")" "${options[@]}"
  DEV_DIR="$(kiosk_by_name "$CHOICE")"
}

ask_ai() {
  local where="the Edge AI Studio at $EDGE_AI_STUDIO_DIR" default=studio
  studio_present || { where="$where (not found)"; default=mock; }
  while :; do
    choose "Where should the AI come from?" "$default" \
      studio "live AI from $where" \
      mock "mocked AI and simulated hardware — no studio needed"
    if [ "$CHOICE" = mock ] || studio_present; then break; fi
    warn "no studio checkout at $EDGE_AI_STUDIO_DIR — clone it there or set EDGE_AI_STUDIO_DIR in common/.kioskrc, or pick mock (a gateway elsewhere: --skip-studio)"
  done
  [ "$CHOICE" = studio ] || MOCK=1
}

info "Vertical Reference Solutions Blueprint setup"

# What to do, which kiosks, and where the AI comes from — asked on a terminal
# unless a flag already answered.
ASK=0
if [ "$YES" -eq 0 ] && [ -t 0 ]; then ASK=1; fi
if [ "$ASK" -eq 1 ] && [ -z "$THEN" ] && [ "$BUILD" -eq 0 ] && [ "$BUNDLE" -eq 0 ]; then ask_action; fi

resolve_kiosks "$KIOSK_ARG"
if [ "$KIOSK_PINNED" -eq 0 ]; then
  if [ -z "$KIOSK_ARG" ] && [ -z "${KIOSKS:-}" ] && [ "$ASK" -eq 1 ]; then
    ask_kiosks
  fi
  save_kiosks
fi
for dir in "${KIOSK_DIRS[@]}"; do info "Kiosk: $(kiosk_label "$dir") — ${dir#"$WORKSPACE_ROOT"/}/"; done

DEV_DIR="${KIOSK_DIRS[0]}"
if [ "$THEN" = dev ] && [ "${#KIOSK_DIRS[@]}" -gt 1 ]; then
  [ "$ASK" -eq 1 ] || die "--dev runs one kiosk at a time — pick it with --kiosk <$(kiosk_ids | tr ' ' '|')>"
  ask_dev_kiosk
fi
if [ "$ASK" -eq 1 ] && [ "$MOCK" -eq 0 ] && [ -z "$STUDIO" ] && [ "$BUNDLE" -eq 0 ]; then ask_ai; fi
[ "$MOCK" -eq 0 ] || STUDIO=0

# --build only exports from the studio checkout, so it skips the studio's own
# setup unless asked for it explicitly.
if [ -z "$STUDIO" ]; then
  if [ "$BUILD" -eq 1 ]; then STUDIO=0; else STUDIO=1; fi
fi
if [ "$STUDIO" -eq 1 ] || [ "$BUNDLE" -eq 1 ] || { [ "$BUILD" -eq 1 ] && [ "$MOCK" -eq 0 ]; }; then
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

# Each kiosk's own config.yaml (gitignored), then its CMS credentials.
for dir in "${KIOSK_DIRS[@]}"; do
  use_kiosk "$dir"
  ensure_config
  ensure_admin_password
done
use_kiosk "${KIOSK_DIRS[0]}"

# 0. Questions ---------------------------------------------------------------
# Everything below this block is unattended work (npm installs, the studio's
# setup, the build), so whatever needs an answer is asked here.
STUDIO_DEPS=0
if [ "$STUDIO" -eq 1 ] || [ "$BUNDLE" -eq 1 ]; then
  if confirm "Install studio system dependencies (runs sudo $EDGE_AI_STUDIO_DIR/install_dependencies.sh)?"; then
    STUDIO_DEPS=1
  fi
fi
if [ "$HARDWARE" -eq 0 ] && [ "$YES" -eq 0 ] && [ -t 0 ] && command -v apt-get >/dev/null 2>&1; then
  cat <<EOF

Peripheral drivers (frontend/scripts/install-drivers.sh, uses sudo):
  NFC ID card reader    ACS ACR122U   libpcsclite1, pcscd, pcsc-tools
  Document scanner      Ricoh/PFU fi-800R   sane-utils + PFU's pfufs driver (downloaded from PFU)
  OCR rasterizer        poppler-utils
Skip this if no hardware is attached — the reader and scanner are simulated.
EOF
  read -r -p "Install the hardware packages? [y/N] " reply
  case "$reply" in y|Y|yes|YES) HARDWARE=1 ;; esac
fi
# The build's own questions (kiosk mode, window, package format), per kiosk,
# asked now rather than after the installs. Each answer is the complete
# argument list for that kiosk's build, so the build has nothing left to ask.
BUILD_ANSWERS=()
if [ "$MOCK" -eq 1 ]; then BUILD_FLOW=(--mock); else BUILD_FLOW=(--bundle-app); fi
if [ "$BUILD" -eq 1 ]; then
  [ "$YES" -eq 0 ] || BUILD_ARGS=(--yes ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"})
  for dir in "${KIOSK_DIRS[@]}"; do
    use_kiosk "$dir"
    [ "${#KIOSK_DIRS[@]}" -eq 1 ] || info "Build settings for $(kiosk_label "$dir")"
    answers="$(build_answers "${BUILD_FLOW[@]}" ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"})" || die "the build's questions were not answered"
    [ -n "$answers" ] || die "the build's questions were not answered"
    BUILD_ANSWERS+=("$answers")
  done
  use_kiosk "${KIOSK_DIRS[0]}"
fi

# 1. Kiosk npm dependencies -------------------------------------------------
for dir in "${KIOSK_DIRS[@]}"; do
  info "Installing the $(kiosk_id "$dir") kiosk's dependencies (npm install in ${dir#"$WORKSPACE_ROOT"/}/frontend)"
  (cd "$dir/frontend" && npm install)
done

# 2. Optional system packages ----------------------------------------------
# install-drivers.sh is the same in every kiosk; the packages are machine-wide.
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
  [ "$STUDIO_DEPS" -eq 0 ] || install_studio_deps
  for dir in "${KIOSK_DIRS[@]}"; do
    use_kiosk "$dir"
    bundle_dir="$(kiosk_bundle_dir)"
    info "Building and installing the embedded bundle (${bundle_dir#"$WORKSPACE_ROOT"/})"
    "$REPO_ROOT/scripts/bundle.sh" --install
  done
  use_kiosk "${KIOSK_DIRS[0]}"
elif [ "$MOCK" -eq 1 ]; then
  info "No Edge AI Studio (--mock) — the AI services are mocked"
elif [ "$STUDIO" -eq 0 ] && [ "$BUILD" -eq 1 ]; then
  info "Not setting up the Edge AI Studio — the build only exports from its checkout (add --studio to set it up too)"
elif [ "$STUDIO" -eq 0 ]; then
  info "Kiosk dependencies only — not setting up the Edge AI Studio (--skip-studio)"
else
  info "Setting up Edge AI Studio at $EDGE_AI_STUDIO_DIR"
  if [ "$STUDIO_DEPS" -eq 1 ]; then
    install_studio_deps
  else
    warn "Skipped studio system dependencies — its setup may fail if they are missing."
  fi

  info "Running the studio's own setup (thirdparty runtimes, AI workers, gateway build) — this can take a while"
  (cd "$EDGE_AI_STUDIO_DIR" && ./setup.sh)
  ok "Edge AI Studio is set up"

  # Preset the services each kiosk's deployment.json lists for its terminal mode.
  studio_ensure_deployment

  if [ "$PACKAGE_STUDIO" -eq 1 ]; then
    info "Packaging the studio executable ($EDGE_AI_STUDIO_DIR/scripts/bash/package.sh)"
    (cd "$EDGE_AI_STUDIO_DIR" && ./scripts/bash/package.sh)
    ok "Studio executable: $EDGE_AI_STUDIO_DIR/out/EdgeAIDemoStudio/EdgeAIDemoStudio"
  fi
fi

# 4. Production build (--build) ---------------------------------------------
if [ "$BUILD" -eq 1 ]; then
  for i in "${!KIOSK_DIRS[@]}"; do
    use_kiosk "${KIOSK_DIRS[$i]}"
    mapfile -t args < <(printf '%s\n' "${BUILD_ANSWERS[$i]}")
    info "Building the $(kiosk_label "$KIOSK_DIR") desktop app (scripts/build.sh)"
    if [ "$MOCK" -eq 1 ]; then
      "$REPO_ROOT/scripts/build.sh" --mock -- "${args[@]}"
    else
      "$REPO_ROOT/scripts/build.sh" -- "${args[@]}"
    fi
  done
  use_kiosk "${KIOSK_DIRS[0]}"
fi

# 5. Done -------------------------------------------------------------------
# Commands as the user runs them: the root launchers, or this kiosk's own.
if [ "$KIOSK_PINNED" -eq 1 ]; then RUN="${KIOSK_DIR#"$WORKSPACE_ROOT"/}/scripts/"; else RUN="./"; fi
if [ "${#KIOSK_DIRS[@]}" -eq 1 ]; then S=""; else S="s"; fi
echo
ok "Setup complete."
echo
if [ "${#KIOSK_DIRS[@]}" -eq 1 ]; then
  echo "Admin login (Payload CMS at /admin): $(kiosk_admin_login)"
else
  echo "Admin logins (Payload CMS at /admin):"
  for dir in "${KIOSK_DIRS[@]}"; do
    use_kiosk "$dir"
    printf '  %-16s %s\n' "$(kiosk_id "$dir")" "$(kiosk_admin_login)"
  done
  use_kiosk "${KIOSK_DIRS[0]}"
fi
RUN_ARGS=()
[ "$MOCK" -eq 0 ] || RUN_ARGS=(--mock)
if [ "$THEN" = start ]; then
  echo
  info "Starting the kiosk$S — next time, skip setup: ${RUN}start.sh${RUN_ARGS[*]+ ${RUN_ARGS[*]}}"
  [ "$KIOSK_PINNED" -eq 1 ] || exec env -u KIOSK_DIR "$REPO_ROOT/start.sh" --kiosk "$(selected_kiosk_ids | tr -d ' ')" ${RUN_ARGS[@]+"${RUN_ARGS[@]}"}
  exec "$REPO_ROOT/start.sh" ${RUN_ARGS[@]+"${RUN_ARGS[@]}"}
elif [ "$THEN" = dev ]; then
  use_kiosk "$DEV_DIR"
  echo
  info "Starting $(kiosk_label "$DEV_DIR") in development mode — next time, skip setup: common/scripts/dev/dev.sh --kiosk $(kiosk_id "$DEV_DIR")${RUN_ARGS[*]+ ${RUN_ARGS[*]}}"
  exec "$REPO_ROOT/scripts/dev/dev.sh" ${RUN_ARGS[@]+"${RUN_ARGS[@]}"}
fi
if [ "$BUILD" -eq 1 ] && [ "$MOCK" -eq 1 ]; then
  cat <<EOF

Mocked desktop app$S in build/ (*-mock.AppImage). Next step:
  ${RUN}start.sh --desktop --mock   open the app$S — no studio needed

Docs: common/docs/build.md
EOF
elif [ "$MOCK" -eq 1 ]; then
  cat <<EOF

Next steps:
  ${RUN}start.sh --mock           start the kiosk$S with mocked AI — no studio needed
  ${RUN}setup.sh --build --mock   or package the kiosk$S as desktop apps, then
  ${RUN}start.sh --desktop --mock open them

Docs: README.md and common/docs/ (getting-started, dev-mode, build, configuration)
EOF
elif [ "$BUILD" -eq 1 ]; then
  cat <<EOF

Packages are in build/. Next steps:
  ${RUN}start.sh --desktop$([ -z "$S" ] || printf ' --kiosk <name>')   launch a packaged app from this checkout
  build/*.deb, *.AppImage         install the .deb on a terminal (sudo dpkg -i), or copy the .AppImage over

Docs: common/docs/build.md (deploying a terminal, uninstalling)
EOF
else
  cat <<EOF

Next steps:
  ${RUN}start.sh                start the Edge AI Studio and the kiosk$S (production build)
  ${RUN}start.sh --no-studio    kiosk$S only, against a gateway that is already up
  ${RUN}setup.sh --build        package the kiosk$S as desktop apps (embedded bundle; installs
                            the electron/ deps itself)
  common/scripts/dev/dev.sh --kiosk $([ -z "$S" ] && kiosk_id "$KIOSK_DIR" || printf '<name>')
                            one kiosk in development mode (hot reload; --mock: no studio needed)

Docs: README.md and common/docs/ (getting-started, dev-mode, build, configuration)
EOF
fi
