#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Remove an installed kiosk desktop app and, on request, everything it wrote.
#
#   ./uninstall.sh              remove the package, keep the data (every kiosk
#                               ./setup.sh set up, or --kiosk <names>)
#   ./uninstall.sh --data       also remove the app data directory
#   ./uninstall.sh --dry-run    list what would go, remove nothing
#
# See docs/build.md.

# shellcheck source=scripts/common.sh disable=SC1091
. "$(cd "$(dirname "$0")" && pwd)/scripts/common.sh"

DATA=0 CACHES=0 KEEP_PACKAGE=0 DRY=0 YES=0 KIOSK_ARG=""
PASS_ARGS=()

usage() {
  cat <<EOF
Usage: ./uninstall.sh [options]

Removes the packaged kiosk (.deb or .AppImage) and reports what it left
behind. The app data directory holds the terminal's own database, captured
documents and enrolled portraits — and, for the embedded bundle, the unpacked
platform with its worker environments and models (tens of GB) — so it is kept
unless --data says otherwise.

Options:
  --kiosk <names>  which kiosks' apps: $(kiosk_ids | sed 's/ /, /g') or all, comma separated
                   (default: what ./setup.sh saved).
                   <kiosk>/scripts/uninstall.sh acts on that kiosk alone
  --data           also remove the app data directory (database, documents,
                   face photos, unpacked platform, worker venvs, models)
  --caches         also remove the uv / huggingface / npm caches. These are
                   SHARED with every other project on the machine — only pass
                   this on a dedicated terminal
  --keep-package   leave the installed package alone, act on the data only
  --dry-run        print what would be removed, remove nothing
  -y, --yes        do not ask
  -h, --help       this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --kiosk) shift; KIOSK_ARG="${1:-}"; [ -n "$KIOSK_ARG" ] || die "--kiosk needs a value"; shift; continue ;;
    --data) DATA=1 ;;
    --caches) CACHES=1 ;;
    --keep-package) KEEP_PACKAGE=1 ;;
    --dry-run) DRY=1 ;;
    -y|--yes) YES=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "unknown option: $1" ;;
  esac
  PASS_ARGS+=("$1")
  shift
done

# Several kiosks: one run each, every one with its own list and confirmation.
resolve_kiosks "$KIOSK_ARG"
if [ "${#KIOSK_DIRS[@]}" -gt 1 ]; then
  status=0
  for dir in "${KIOSK_DIRS[@]}"; do
    echo
    KIOSK_DIR="$dir" "$0" ${PASS_ARGS[@]+"${PASS_ARGS[@]}"} || status=$?
  done
  exit "$status"
fi

# The package identity lives in the kiosk's kiosk.json; the defaults are the
# fallback for a copy of this script that travels without the checkout.
PKG_JSON="$KIOSK_DIR/kiosk.json"
pkg_value() {
  [ -f "$PKG_JSON" ] || return 1
  sed -n "s/^[[:space:]]*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$PKG_JSON" | head -1
}
PRODUCT="$(pkg_value productName || true)"
BINARY="$(pkg_value executableName || true)"
IDENTIFIER="$(pkg_value appId || true)"
DATA_NAME="$(pkg_value dataDir || true)"
PRODUCT="${PRODUCT:-Vertical Reference Solutions Blueprint}"
IDENTIFIER="${IDENTIFIER:-com.verticalreferencesolutionsblueprint.desktop}"
BINARY="${BINARY:-kiosk-desktop}"
DATA_NAME="${DATA_NAME:-VRSB}"
# Data lives under the short dataDir name; earlier builds used the full identifier.
DATA_BASE="${XDG_DATA_HOME:-$HOME/.local/share}"
DATA_DIR="$DATA_BASE/$DATA_NAME"
[ -d "$DATA_DIR" ] || [ ! -d "$DATA_BASE/$IDENTIFIER" ] || DATA_DIR="$DATA_BASE/$IDENTIFIER"

REMOVALS=()
PACKAGE=""

size_of() { du -sh "$1" 2>/dev/null | cut -f1; }

# rm -rf with a path this script computed, so the guard is against a bad
# computation, not against the user.
remove_path() {
  local target="$1"
  case "$target" in
    ""|"/"|"$HOME"|"$HOME/") die "refusing to remove $target" ;;
    "$HOME"/*|/opt/*|/usr/*|/tmp/*) ;;
    *) die "refusing to remove a path outside \$HOME, /opt, /usr and /tmp: $target" ;;
  esac
  [ -e "$target" ] || return 0
  rm -rf -- "$target"
  ok "removed $target"
}

deb_package() {
  command -v dpkg >/dev/null 2>&1 || return 1
  local pkg=""
  if [ -e "/usr/bin/$BINARY" ] && command -v dpkg-query >/dev/null 2>&1; then
    pkg="$(dpkg-query -S "/usr/bin/$BINARY" 2>/dev/null | cut -d: -f1 | head -1)"
  fi
  if [ -z "$pkg" ]; then
    local slug
    slug="$(printf '%s' "$PRODUCT" | tr '[:upper:] ' '[:lower:]-')"
    pkg="$(dpkg-query -W -f '${Package}\n' 2>/dev/null | grep -ix -e "$BINARY" -e "$slug" | head -1 || true)"
  fi
  [ -n "$pkg" ] || return 1
  printf '%s\n' "$pkg"
}

appimages() {
  local dirs=("$HOME/Applications" "$HOME/.local/bin" "$HOME/Desktop" "$HOME/Downloads" "/opt")
  local existing=()
  for d in "${dirs[@]}"; do [ -d "$d" ] && existing+=("$d"); done
  [ ${#existing[@]} -gt 0 ] || return 0
  find "${existing[@]}" -maxdepth 1 -type f -name "${PRODUCT}*.AppImage" 2>/dev/null | sort
}

# appimaged / "integrate?" prompts drop a launcher pointing at the file.
desktop_entries() {
  local image="$1" dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  [ -d "$dir" ] || return 0
  grep -rlF "$(basename "$image")" "$dir" --include='*.desktop' 2>/dev/null || true
}

running_pids() {
  command -v pgrep >/dev/null 2>&1 || return 0
  { pgrep -x "$BINARY" 2>/dev/null || true
    pgrep -f "$DATA_DIR" 2>/dev/null || true
  } | sort -u | grep -vx -e "$$" -e "${PPID:-}" || true
}

info "Product: $PRODUCT ($IDENTIFIER)"

if [ "$KEEP_PACKAGE" -eq 0 ]; then
  if PACKAGE="$(deb_package)"; then
    info "Installed .deb package: $PACKAGE"
  else
    PACKAGE=""
    while IFS= read -r image; do
      [ -n "$image" ] || continue
      REMOVALS+=("$image")
      while IFS= read -r entry; do
        [ -n "$entry" ] && REMOVALS+=("$entry")
      done < <(desktop_entries "$image")
    done < <(appimages)
    [ ${#REMOVALS[@]} -gt 0 ] || info "No installed package found (an .AppImage that was moved elsewhere must be deleted by hand)"
  fi
fi

if [ "$DATA" -eq 1 ] && [ -d "$DATA_DIR" ]; then
  REMOVALS+=("$DATA_DIR")
elif [ -d "$DATA_DIR" ]; then
  warn "keeping $DATA_DIR ($(size_of "$DATA_DIR")) — pass --data to remove it"
fi

if [ "$CACHES" -eq 1 ]; then
  for cache in "$HOME/.cache/uv" "$HOME/.cache/huggingface" "$HOME/.npm"; do
    [ -d "$cache" ] && REMOVALS+=("$cache")
  done
fi

if [ -z "$PACKAGE" ] && [ ${#REMOVALS[@]} -eq 0 ]; then
  ok "nothing to remove"
  exit 0
fi

echo
info "To be removed:"
[ -n "$PACKAGE" ] && echo "  package  $PACKAGE (dpkg)"
for target in "${REMOVALS[@]}"; do
  printf '  %-8s %s\n' "$(size_of "$target")" "$target"
done
case "$DATA:$(test -d "$DATA_DIR" && echo y || echo n)" in
  1:y) warn "the data directory holds the kiosk database, captured documents and enrolled portraits — they are not recoverable" ;;
esac
[ "$CACHES" -eq 1 ] && warn "the uv/huggingface/npm caches are shared with every other project on this machine"
echo

if [ "$DRY" -eq 1 ]; then
  info "--dry-run: nothing was removed"
  exit 0
fi

if [ "$YES" -eq 0 ]; then
  [ -t 0 ] || die "not a terminal — re-run with --yes to confirm non-interactively"
  printf 'Proceed? [y/N] '
  read -r reply
  case "$reply" in y|Y|yes|YES) ;; *) die "aborted" ;; esac
fi

PIDS="$(running_pids)"
if [ -n "$PIDS" ]; then
  info "Stopping the running kiosk ($(echo "$PIDS" | tr '\n' ' '))"
  # shellcheck disable=SC2086
  kill $PIDS 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    PIDS="$(running_pids)"
    [ -n "$PIDS" ] || break
    sleep 1
  done
  if [ -n "$PIDS" ]; then
    # shellcheck disable=SC2086
    kill -9 $PIDS 2>/dev/null || true
  fi
fi

if [ -n "$PACKAGE" ]; then
  if [ "$(id -u)" -eq 0 ]; then
    dpkg -r "$PACKAGE"
  elif command -v sudo >/dev/null 2>&1; then
    info "Removing $PACKAGE (sudo)"
    sudo dpkg -r "$PACKAGE"
  else
    die "removing $PACKAGE needs root: run 'dpkg -r $PACKAGE' as root, then re-run this script"
  fi
  ok "removed package $PACKAGE"
fi

for target in "${REMOVALS[@]}"; do
  remove_path "$target"
done

echo
ok "done"
if [ "$DATA" -eq 0 ] && [ -d "$DATA_DIR" ]; then
  info "Data kept at $DATA_DIR ($(size_of "$DATA_DIR"))"
fi
if [ "$CACHES" -eq 0 ]; then
  info "Package caches were left alone: ~/.cache/uv, ~/.cache/huggingface, ~/.npm"
fi
if [ -d "$BUILD_DIR" ]; then
  info "Build output in $BUILD_DIR is untouched — remove it by hand if you no longer need it"
fi
