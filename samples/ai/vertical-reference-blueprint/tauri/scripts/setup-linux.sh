#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Install what Tauri needs to build on Ubuntu/Debian. Safe to re-run.
#
# Tauri renders with the system WebView — WebKitGTK here — so the build needs
# its headers, and the shell itself is Rust.
set -euo pipefail

echo "▸ System libraries (sudo)"
sudo apt-get update

# Tauri v2's list for Debian/Ubuntu. libgtk-3-dev is not in it: the WebKitGTK
# headers pull GTK in. The tray library is the Ayatana fork — the older
# libappindicator3-dev conflicts with it on 22.04 and later, and apt will
# refuse the whole install rather than pick.
deps=(
  libwebkit2gtk-4.1-dev
  libayatana-appindicator3-dev
  librsvg2-dev
  patchelf
  build-essential
  curl
  wget
  file
  libssl-dev
  libxdo-dev
)

# Highest version of a package across every configured source, ignoring which
# one apt would prefer.
newest() {
  local best=""
  while read -r version; do
    if [ -z "$best" ] || dpkg --compare-versions "$version" gt "$best"; then
      best="$version"
    fi
  # A version line is "<version> <priority>" and nothing else; the source URLs
  # listed under each one, and the installed marker, are not.
  done < <(apt-cache policy "$1" |
    awk '$1 == "***" { print $2; next } NF == 2 && $2 ~ /^[0-9]+$/ { print $1 }')
  printf '%s' "$best"
}

# GTK's dev package wants EGL headers, which it asks for as libegl1-mesa-dev.
# In current Ubuntu that is an empty shim onto libglvnd and pulls no driver.
# Older builds of it — which a machine with Intel's GPU repository pinned above
# the archive will be handed — instead depend on an exact libegl-mesa0 version,
# and installing one downgrades the whole mesa runtime under a GPU stack that
# may well be the reason the pin is there. Ask for the shim by version instead.
# Captured rather than piped: apt-get exits non-zero on the very plan we are
# looking for, and `set -o pipefail` would report that as "no match".
plan="$(apt-get -s install -y "${deps[@]}" 2>&1 || true)"
if printf '%s\n' "$plan" | grep -q 'DOWNGRADED'; then
  egl="$(newest libegl1-mesa-dev)"
  echo "▸ Taking libegl1-mesa-dev $egl, so mesa is left alone"
  deps+=("libegl1-mesa-dev=$egl")
fi

sudo apt-get install -y "${deps[@]}"

if command -v cargo >/dev/null 2>&1; then
  echo "▸ Rust already installed: $(cargo --version)"
else
  echo "▸ Rust"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

echo
echo "Done. Open a new shell (or 'source \$HOME/.cargo/env'), then:"
echo "  cd tauri && ./build.sh"
