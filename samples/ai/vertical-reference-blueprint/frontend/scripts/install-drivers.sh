#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Install the drivers for the kiosk's peripherals (Debian/Ubuntu, uses sudo).
#
#   ./scripts/install-drivers.sh            # or: npm run drivers:install
#   ./scripts/install-drivers.sh --yes      # non-interactive apt
#   ./scripts/install-drivers.sh --pfufs-deb ~/Downloads/pfufs-ubuntu22.04_2.9.0_amd64.deb
#
# What it installs, and why:
#
#   NFC ID card reader (PC/SC, e.g. ACS ACR122U)
#     libpcsclite1 + pcscd + pcsc-tools — the PC/SC daemon the pcsc-mini
#     bindings talk to, and pcsc_scan to prove the reader works.
#
#   Document scanner (Ricoh/PFU fi-800R)
#     sane-utils — the `scanimage` frontend the kiosk drives.
#     pfufs — PFU's proprietary SANE backend for the fi Series. The generic
#     SANE backends do NOT drive the fi-800R the way the kiosk needs it
#     (Adf-duplex, --page-auto, multifeed detection), and the paper-detect
#     tool the kiosk polls before each scan (`pfufsgetscstatus`) only ships
#     with this driver. It is a licensed download, so this script installs it
#     from a .deb you have already downloaded (see below) rather than
#     fetching it itself.
#
#   OCR rasterizer
#     poppler-utils — `pdftoppm`, which turns captured PDFs into page images
#     for the OCR service.
#
# The webcam needs no driver package: it is a standard UVC device read in the
# browser via getUserMedia.
#
# Getting the pfufs .deb: download the "fi Series Linux driver" for the
# fi-800R from PFU's (Ricoh) support site —
# https://www.pfu.ricoh.com/global/scanners/fi/support/software/ — then
# either pass it with --pfufs-deb, set PFUFS_DEB, or drop it in this repo's
# root or ~/Downloads and re-run; the script picks up pfufs*.deb from those
# places. The driver guide is P2U3-0200-08ENZ0.pdf, shipped alongside it.

set -euo pipefail

if [ -t 1 ]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  BOLD=""; RED=""; GREEN=""; YELLOW=""; RESET=""
fi
info() { echo "${BOLD}==>${RESET} $*"; }
ok()   { echo "${GREEN} ✓ ${RESET} $*"; }
warn() { echo "${YELLOW}warning:${RESET} $*" >&2; }
die()  { echo "${RED}error:${RESET} $*" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

YES=0 PFUFS_DEB="${PFUFS_DEB:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1 ;;
    --pfufs-deb) shift; PFUFS_DEB="${1:-}" ;;
    -h|--help) sed -n '2,36p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done

command -v apt-get >/dev/null 2>&1 \
  || die "apt-get not found — this script supports Debian/Ubuntu. Install pcsc-lite, sane and the PFU fi Series driver with your distribution's package manager instead."

APT_YES=""
[ "$YES" -eq 1 ] && APT_YES="-y"

# 1. Distro packages: PC/SC (NFC), SANE frontend, poppler (OCR) ---------------
info "Installing system packages (sudo): pcscd, pcsc-tools, sane-utils, poppler-utils"
sudo apt-get update
sudo apt-get install $APT_YES libpcsclite1 pcscd pcsc-tools sane-utils poppler-utils

info "Enabling the PC/SC daemon (pcscd)"
sudo systemctl enable --now pcscd \
  || warn "could not start pcscd — NFC reads will be simulated until it runs"

# 2. PFU fi Series scanner driver (pfufs) -------------------------------------
if command -v pfufsgetscstatus >/dev/null 2>&1 || dpkg -s pfufs >/dev/null 2>&1; then
  ok "PFU fi Series driver (pfufs) is already installed"
else
  # Not passed explicitly: look where a downloaded driver plausibly sits.
  if [ -z "$PFUFS_DEB" ]; then
    for candidate in "$REPO_ROOT"/pfufs*.deb "$HOME"/Downloads/pfufs*.deb; do
      [ -f "$candidate" ] && { PFUFS_DEB="$candidate"; break; }
    done
  fi
  if [ -n "$PFUFS_DEB" ]; then
    [ -f "$PFUFS_DEB" ] || die "pfufs package not found: $PFUFS_DEB"
    info "Installing PFU fi Series driver from $PFUFS_DEB"
    sudo dpkg -i "$PFUFS_DEB" || sudo apt-get install $APT_YES -f
    ok "pfufs driver installed"
  else
    warn "PFU fi Series driver (pfufs) is not installed and no pfufs*.deb was found."
    warn "The fi-800R will not scan without it — document capture falls back to stand-ins."
    warn "Download the 'fi Series Linux driver' for the fi-800R from"
    warn "  https://www.pfu.ricoh.com/global/scanners/fi/support/software/"
    warn "then re-run this script (it looks in $REPO_ROOT and ~/Downloads),"
    warn "or point it at the file: ./scripts/install-drivers.sh --pfufs-deb <path>"
  fi
fi

# 3. Verify -------------------------------------------------------------------
echo
info "Checking what answers"
if systemctl is-active --quiet pcscd 2>/dev/null; then
  ok "pcscd is running — tap a card under 'npm run nfc:probe' to read its serial"
else
  warn "pcscd is not running"
fi
if command -v scanimage >/dev/null 2>&1; then
  if scanimage -L 2>/dev/null | grep -qi pfufs; then
    ok "scanner found: $(scanimage -L | grep -i pfufs | head -1)"
  else
    warn "no pfufs scanner detected (scanimage -L) — is the fi-800R connected and powered on?"
  fi
fi
if command -v pfufsgetscstatus >/dev/null 2>&1; then
  ok "pfufsgetscstatus present — paper detection will work"
fi
echo
ok "Driver setup finished. Verify end to end: pcsc_scan (NFC), scanimage -L (scanner)."
