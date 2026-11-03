#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THIRDPARTY_DIR="${1:-$SCRIPT_DIR/../../thirdparty}"
NODE_ZIP_PATH="$THIRDPARTY_DIR/node.tar.xz"
NODE_VERSION="v24.22.1"
NODE_URL="https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz"
NODE_DIR="$THIRDPARTY_DIR/node"
NODE_PATH="$NODE_DIR/bin/node"

FFMPEG_TAR_PATH="$THIRDPARTY_DIR/ffmpeg-linux64-gpl.tar.xz"
FFMPEG_TAR_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-31-13-27/ffmpeg-n9.0.1-11-ge47273f4d9-linux64-gpl-9.0.tar.xz"
FFMPEG_DIR="$THIRDPARTY_DIR/ffmpeg"
FFMPEG_PATH="$FFMPEG_DIR/bin/ffmpeg"

# qmassa reads GPU usage. Upstream ships source only, so it is built from the pinned tag with a
# throwaway Rust toolchain and zig as the linker: no sudo, gcc, pkg-config or libudev-dev.
QMASSA_VERSION="2.2.0"
QMASSA_SRC_URL="https://github.com/ulissesf/qmassa/archive/refs/tags/qmassa-v$QMASSA_VERSION.tar.gz"
QMASSA_SRC_SHA256="9a92521224bdb16e480fe1631e86832e8ecc99e9b4e09c6da55a567227a5bf48"
QMASSA_DIR="$THIRDPARTY_DIR/qmassa"
QMASSA_PATH="$QMASSA_DIR/bin/qmassa"
QMASSA_BUILD_DIR="$THIRDPARTY_DIR/.qmassa-build"
QMASSA_BUILD_LOG="$THIRDPARTY_DIR/qmassa-build.log"
RUST_TOOLCHAIN="1.98.0"
RUSTUP_INIT_URL="https://static.rust-lang.org/rustup/archive/1.29.1/x86_64-unknown-linux-gnu/rustup-init"
RUSTUP_INIT_SHA256="dda7234360b7f578ca8b0ddcb80145646fa61a67c1720a5abc7051b35c9fcb71"
ZIG_URL="https://ziglang.org/download/0.16.0/zig-x86_64-linux-0.16.0.tar.xz"
ZIG_SHA256="70e49664a74374b48b51e6f3fdfbf437f6395d42509050588bd49abe52ba3d00"
CARGO_ZIGBUILD_URL="https://github.com/rust-cross/cargo-zigbuild/releases/download/v0.23.4/cargo-zigbuild-x86_64-unknown-linux-gnu.tar.xz"
CARGO_ZIGBUILD_SHA256="6b69963040818ca1ef573d8135a95aa902e17cf7f873c32c6426642dadfe7f59"

# GPU names: distributions ship a pci.ids too old for recent GPUs (Ubuntu
# 24.04's has no Arc B-series), so qmassa reports bare device IDs like E211.
PCI_IDS_URL="https://raw.githubusercontent.com/pciutils/pciids/22da7386ba818c037894f258248734770757b14f/pci.ids"
PCI_IDS_SHA256="5061033a8c13354302ef9f01e8c439fa5221655aca4132dd85866efc52412634"
PCI_IDS_PATH="$THIRDPARTY_DIR/pci.ids"

cleanup_temp_files() {
    rm -f "$NODE_ZIP_PATH" "$FFMPEG_TAR_PATH" 2>/dev/null
    rm -rf "$QMASSA_BUILD_DIR" 2>/dev/null
}
trap cleanup_temp_files EXIT INT TERM

setup_thirdparty() {
  echo "Creating thirdparty directory at $THIRDPARTY_DIR..."
  if ! mkdir -p "$THIRDPARTY_DIR"; then
    echo "❌ ERROR: Failed to create thirdparty directory at $THIRDPARTY_DIR"
    exit 1
  fi
  
  if ! install_node; then
    echo "❌ ERROR: Node.js installation failed"
    exit 1
  fi
  
  if ! install_ffmpeg; then
    echo "❌ ERROR: FFmpeg installation failed"
    exit 1
  fi

  # Optional: without it the app runs, but shows no GPU usage.
  if ! install_qmassa; then
    echo "⚠️  WARNING: qmassa was not installed; GPU usage will not be shown"
  fi
  if ! install_pci_ids; then
    echo "⚠️  WARNING: pci.ids was not downloaded; recent GPUs show their PCI IDs"
  fi

  echo "✅ Thirdparty setup completed successfully"
}

# Install Node.js unless the pinned version is already present
install_node() {
  local installed=""
  if [ -f "$NODE_PATH" ]; then
    installed="$("$NODE_PATH" --version 2>/dev/null || true)"
    if [ "$installed" != "$NODE_VERSION" ]; then
      echo "Replacing Node.js ${installed:-(unknown version)} with $NODE_VERSION ..."
      rm -rf "$NODE_DIR"
    fi
  fi

  if [ ! -f "$NODE_PATH" ]; then
    echo "Installing Node.js $NODE_VERSION ..."
    
    if ! mkdir -p "$NODE_DIR"; then
      echo "❌ ERROR: Failed to create Node.js directory at $NODE_DIR"
      return 1
    fi
    
    echo "Downloading Node.js from $NODE_URL ..."
    if ! wget -nv -O "$NODE_ZIP_PATH" "$NODE_URL"; then
      echo "❌ ERROR: Failed to download Node.js from $NODE_URL"
      echo "Please check your internet connection and try again."
      return 1
    fi
    
    echo "Extracting Node.js..."
    if ! tar -xJf "$NODE_ZIP_PATH" -C "$NODE_DIR" --strip-components=1; then
      echo "❌ ERROR: Failed to extract Node.js archive"
      rm -f "$NODE_ZIP_PATH"
      return 1
    fi
    
    rm "$NODE_ZIP_PATH"
    
    if [ ! -f "$NODE_PATH" ]; then
      echo "❌ ERROR: Node.js binary not found at $NODE_PATH after extraction"
      return 1
    fi
    
    if ! "$NODE_PATH" --version >/dev/null 2>&1; then
      echo "❌ ERROR: Node.js installation verification failed"
      return 1
    fi
    
    echo "✅ Node.js installed successfully at $NODE_PATH"
  else
    echo "Node.js already installed at $NODE_PATH"
  fi
  
  return 0
}

install_ffmpeg() {
  if [ -d "$FFMPEG_DIR" ]; then
    echo "✅ FFmpeg directory already exists at $FFMPEG_DIR. Skipping download."
    return 0
  fi
  
  echo "Downloading FFmpeg for Linux..."
  echo "Downloading from $FFMPEG_TAR_URL..."
  if ! wget -nv -O "$FFMPEG_TAR_PATH" "$FFMPEG_TAR_URL"; then
    echo "❌ ERROR: Failed to download FFmpeg"
    return 1
  fi
  
  echo "Extracting FFmpeg..."
  if ! tar -xf "$FFMPEG_TAR_PATH" -C "$THIRDPARTY_DIR"; then
    echo "❌ ERROR: Failed to extract FFmpeg archive"
    rm -f "$FFMPEG_TAR_PATH"
    return 1
  fi
  
  EXTRACTED_DIR=$(find "$THIRDPARTY_DIR" -maxdepth 1 -type d -name "ffmpeg-*" | head -1)
  if [ -z "$EXTRACTED_DIR" ]; then
    echo "❌ ERROR: Could not find extracted FFmpeg directory"
    rm -f "$FFMPEG_TAR_PATH"
    return 1
  fi
  
  if ! mkdir -p "$FFMPEG_DIR/bin"; then
    echo "❌ ERROR: Failed to create FFmpeg bin directory"
    rm -rf "$EXTRACTED_DIR"
    rm -f "$FFMPEG_TAR_PATH"
    return 1
  fi
  
  # BtbN builds put the binaries under bin/.
  if ! cp "$EXTRACTED_DIR/bin/ffmpeg" "$FFMPEG_DIR/bin/" || \
     ! cp "$EXTRACTED_DIR/bin/ffprobe" "$FFMPEG_DIR/bin/"; then
    echo "❌ ERROR: Failed to copy FFmpeg binaries"
    rm -rf "$EXTRACTED_DIR"
    rm -f "$FFMPEG_TAR_PATH"
    return 1
  fi
  
  chmod +x "$FFMPEG_DIR/bin/ffmpeg"
  chmod +x "$FFMPEG_DIR/bin/ffprobe"
  
  rm -rf "$EXTRACTED_DIR"
  
  rm -f "$FFMPEG_TAR_PATH"
  
  if [ ! -x "$FFMPEG_PATH" ]; then
    echo "❌ ERROR: FFmpeg installation verification failed - binary not found or not executable"
    return 1
  fi
  
  if ! "$FFMPEG_PATH" -version >/dev/null 2>&1; then
    echo "❌ ERROR: FFmpeg binary found but not working properly"
    return 1
  fi
  
  echo "✅ FFmpeg downloaded and extracted successfully."
  return 0
}

# Download $1 to $2 and check it against the sha256 $3
download_verified() {
  local url="$1" dest="$2" sha256="$3"
  if ! wget -nv -O "$dest" "$url"; then
    echo "❌ ERROR: Failed to download $url"
    return 1
  fi
  if ! echo "$sha256  $dest" | sha256sum -c --status -; then
    echo "❌ ERROR: Checksum mismatch for $url"
    return 1
  fi
}

# The runtime libudev every systemd distribution ships. The build links
# against it directly, which is all libudev-dev would have added.
find_libudev() {
  local dir
  for dir in /usr/lib/x86_64-linux-gnu /lib/x86_64-linux-gnu /usr/lib64 /lib64 /usr/lib; do
    if [ -e "$dir/libudev.so.1" ]; then
      echo "$dir/libudev.so.1"
      return 0
    fi
  done
  return 1
}

# Build qmassa unless the pinned version is already installed
install_qmassa() {
  local installed=""
  if [ -x "$QMASSA_PATH" ]; then
    installed="$("$QMASSA_PATH" --version 2>/dev/null || true)"
    if [ "$installed" = "qmassa $QMASSA_VERSION" ]; then
      echo "qmassa $QMASSA_VERSION already installed at $QMASSA_PATH"
      return 0
    fi
    echo "Replacing ${installed:-qmassa (unknown version)} with qmassa $QMASSA_VERSION ..."
  fi

  local status=0
  build_qmassa || status=1
  rm -rf "$QMASSA_BUILD_DIR"
  return $status
}

build_qmassa() {
  local build="$QMASSA_BUILD_DIR" libudev glibc

  if [ "$(uname -m)" != "x86_64" ]; then
    echo "❌ ERROR: qmassa is only built for x86_64"
    return 1
  fi
  if ! libudev="$(find_libudev)"; then
    echo "❌ ERROR: libudev.so.1 not found"
    return 1
  fi
  # Linked against this machine's glibc, the one it runs with.
  glibc="$(getconf GNU_LIBC_VERSION 2>/dev/null | awk '{print $2}')"
  if [ -z "$glibc" ]; then
    echo "❌ ERROR: Could not read the glibc version"
    return 1
  fi

  echo "Building qmassa $QMASSA_VERSION from source (a few minutes, once)..."
  rm -rf "$build"
  if ! mkdir -p "$build/src" "$build/zig" "$build/cargo-zigbuild" "$build/libudev" "$build/src/.cargo"; then
    echo "❌ ERROR: Failed to create $build"
    return 1
  fi

  download_verified "$QMASSA_SRC_URL" "$build/qmassa.tar.gz" "$QMASSA_SRC_SHA256" || return 1
  download_verified "$RUSTUP_INIT_URL" "$build/rustup-init" "$RUSTUP_INIT_SHA256" || return 1
  download_verified "$ZIG_URL" "$build/zig.tar.xz" "$ZIG_SHA256" || return 1
  download_verified "$CARGO_ZIGBUILD_URL" "$build/cargo-zigbuild.tar.xz" "$CARGO_ZIGBUILD_SHA256" || return 1

  if ! tar -xzf "$build/qmassa.tar.gz" -C "$build/src" --strip-components=1 ||
     ! tar -xJf "$build/zig.tar.xz" -C "$build/zig" --strip-components=1 ||
     ! tar -xJf "$build/cargo-zigbuild.tar.xz" -C "$build/cargo-zigbuild" --strip-components=1; then
    echo "❌ ERROR: Failed to extract the qmassa build inputs"
    return 1
  fi
  chmod +x "$build/rustup-init"
  ln -s "$libudev" "$build/libudev/libudev.so"

  # zig links everything, build scripts included: it brings its own libc
  # stubs and start files, so neither gcc nor libc6-dev is needed.
  cat > "$build/zigcc" <<EOF
#!/bin/sh
exec "$build/cargo-zigbuild/cargo-zigbuild" zig cc -- -target x86_64-linux-gnu.$glibc "\$@"
EOF
  chmod +x "$build/zigcc"
  # The libudev override stands in for libudev-sys's build script, which
  # asks pkg-config for the libudev-dev files.
  cat > "$build/src/.cargo/config.toml" <<EOF
[target.x86_64-unknown-linux-gnu]
linker = '$build/zigcc'

[target.x86_64-unknown-linux-gnu.libudev]
rustc-link-lib = ['udev']
rustc-link-search = ['$build/libudev']
rustc-cfg = ['hwdb']
EOF

  # Everything the build writes stays under $build.
  if ! (
    export RUSTUP_HOME="$build/rustup" CARGO_HOME="$build/cargo" CARGO_TARGET_DIR="$build/target"
    export XDG_CACHE_HOME="$build/cache" ZIG_GLOBAL_CACHE_DIR="$build/cache/zig" ZIG_LOCAL_CACHE_DIR="$build/cache/zig-local"
    export PATH="$build/zig:$build/cargo/bin:$PATH"
    unset RUSTUP_TOOLCHAIN RUSTFLAGS CARGO_BUILD_TARGET CARGO_BUILD_RUSTFLAGS CARGO_ENCODED_RUSTFLAGS
    "$build/rustup-init" -y -q --no-modify-path --profile minimal --default-toolchain "$RUST_TOOLCHAIN" &&
      cd "$build/src" &&
      cargo build --release --locked -p qmassa
  ) > "$QMASSA_BUILD_LOG" 2>&1; then
    echo "❌ ERROR: qmassa build failed. Last lines of $QMASSA_BUILD_LOG:"
    tail -n 20 "$QMASSA_BUILD_LOG"
    return 1
  fi

  if ! mkdir -p "$QMASSA_DIR/bin" ||
     ! cp "$build/target/release/qmassa" "$QMASSA_PATH.new" ||
     ! mv -f "$QMASSA_PATH.new" "$QMASSA_PATH"; then
    echo "❌ ERROR: Failed to install qmassa at $QMASSA_PATH"
    return 1
  fi
  if [ "$("$QMASSA_PATH" --version 2>/dev/null)" != "qmassa $QMASSA_VERSION" ]; then
    echo "❌ ERROR: qmassa installed but does not run"
    return 1
  fi

  rm -f "$QMASSA_BUILD_LOG"
  echo "✅ qmassa $QMASSA_VERSION installed at $QMASSA_PATH"
  return 0
}

# Download the pinned pci.ids unless it is already there
install_pci_ids() {
  if echo "$PCI_IDS_SHA256  $PCI_IDS_PATH" | sha256sum -c --status - 2>/dev/null; then
    echo "pci.ids already installed at $PCI_IDS_PATH"
    return 0
  fi
  if ! download_verified "$PCI_IDS_URL" "$PCI_IDS_PATH.new" "$PCI_IDS_SHA256" ||
     ! mv -f "$PCI_IDS_PATH.new" "$PCI_IDS_PATH"; then
    rm -f "$PCI_IDS_PATH.new"
    return 1
  fi
  echo "✅ pci.ids installed at $PCI_IDS_PATH"
}

setup_thirdparty

