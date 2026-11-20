#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Checked downloads and install manifests for the third-party tools setup installs. Meant to be
# sourced, not executed. Mirrors scripts/win/thirdparty_integrity.ps1.
#
# Every download is checked against a SHA-256 pinned beside its URL in the setup script, never one
# fetched from the download's own server: whoever can change the file there can change its checksum
# too. Each install then gets a .install-manifest with the SHA-256 and size of its files, so a later
# setup replaces an install that is damaged or was changed, and a start reports one
# (verify_thirdparty.sh).

INSTALL_MANIFEST_NAME=".install-manifest"

# download_verified <url> <dest> <sha256> -- download to <dest>, which is deleted again unless its
# SHA-256 is <sha256>.
download_verified() {
  local url="$1" dest="$2" sha256="$3" actual output size started="$SECONDS"
  if command -v wget >/dev/null 2>&1; then
    # wget names the URL it was redirected to, which for release assets carries a signed query
    # string: only its errors are printed, without query strings.
    if ! output="$(wget -nv -O "$dest" "$url" 2>&1)"; then
      echo "❌ ERROR: Failed to download $url"
      if [ -n "$output" ]; then
        printf '%s\n' "$output" | sed -E 's/\?[^ "]*//g'
      fi
      rm -f "$dest"
      return 1
    fi
  elif ! curl -fsSL -o "$dest" "$url"; then
    echo "❌ ERROR: Failed to download $url"
    rm -f "$dest"
    return 1
  fi
  size="$(stat -c %s "$dest")"
  echo "Downloaded $url ($(numfmt --to=iec-i --suffix=B "$size" 2>/dev/null || echo "$size bytes") in $((SECONDS - started))s)"
  actual="$(sha256sum "$dest" | cut -d' ' -f1)"
  if [ "$actual" != "$sha256" ]; then
    echo "❌ ERROR: Checksum mismatch for $url: expected $sha256, got $actual. The download was deleted and nothing was installed."
    rm -f "$dest"
    return 1
  fi
}

# install_manifest_path <path> -- the manifest of the install at <path>: inside a directory, beside a file.
install_manifest_path() {
  if [ -d "$1" ]; then
    echo "$1/$INSTALL_MANIFEST_NAME"
  else
    echo "$1$INSTALL_MANIFEST_NAME"
  fi
}

# write_install_manifest <path> <source> [<exclude>...] -- record the SHA-256 and size of every file of
# the install at <path> (a directory or a single file) and <source>, what it was installed from. Files
# under an <exclude> directory (relative) are left out: what runs installs packages there.
write_install_manifest() {
  local path="$1" source="$2"
  shift 2
  local manifest
  manifest="$(install_manifest_path "$path")"
  local -a prune=()
  local dir
  for dir in "$@"; do
    prune+=(-path "./$dir" -prune -o)
  done
  {
    echo "# Written by setup, which checks the install against it. Do not edit."
    echo "source $source"
    if [ -d "$path" ]; then
      local size file hash
      (cd "$path" && find . ${prune[@]+"${prune[@]}"} -type f ! -path "./$INSTALL_MANIFEST_NAME" \
        ! -path "./$INSTALL_MANIFEST_NAME.tmp" -printf '%s %P\n') |
        while read -r size file; do
          hash="$(sha256sum "$path/$file")"
          echo "${hash%% *} $size $file"
        done
    else
      echo "$(sha256sum "$path" | cut -d' ' -f1) $(stat -c %s "$path") $(basename "$path")"
    fi
  } > "$manifest.tmp" && mv -f "$manifest.tmp" "$manifest"
}

# check_install <path> [<source>] [quick] -- print what is wrong with the install at <path>, a line
# each, and return 1; return 0 when it is intact. Given <source>, an install from anything else is
# wrong too (another version). "quick" compares sizes only, fast enough for every start; setup
# compares SHA-256 as well.
check_install() {
  local path="$1" source="${2:-}" mode="${3:-full}"
  if [ ! -e "$path" ]; then
    echo "it is not installed"
    return 1
  fi
  local manifest base problems
  manifest="$(install_manifest_path "$path")"
  if [ ! -f "$manifest" ]; then
    echo "it was installed before setup checked downloads (no install manifest)"
    return 1
  fi
  if [ -n "$source" ] && ! grep -qxF "source $source" "$manifest"; then
    echo "it was installed from another download (another version)"
    return 1
  fi
  if [ -d "$path" ]; then base="$path"; else base="$(dirname "$path")"; fi

  if [ "$mode" = "quick" ]; then
    # The sizes on disk against the manifest's, read in one pass.
    problems="$(
      awk 'NR == FNR { size[substr($0, index($0, " ") + 1)] = $1; next }
           /^#/ || /^source / || NF == 0 { next }
           { file = $0; sub(/^[^ ]+ [^ ]+ /, "", file)
             if (!(file in size)) print file " is missing"
             else if (size[file] != $2) print file " changed" }' \
        <(if [ -d "$path" ]; then (cd "$path" && find . -type f -printf '%s %P\n'); \
          else echo "$(stat -c %s "$path") $(basename "$path")"; fi) \
        "$manifest"
    )" || true
  else
    # sha256sum -c reports a missing file as "FAILED open or read", a changed one as "FAILED".
    problems="$(
      grep -v -e '^#' -e '^source ' -e '^$' "$manifest" |
        sed -E 's/^([0-9a-f]+) [0-9]+ /\1  /' |
        (cd "$base" && sha256sum -c --quiet - 2>/dev/null) |
        sed -e 's/: FAILED open or read$/ is missing/' -e 's/: FAILED$/ changed/'
    )" || true
  fi
  if [ -n "$problems" ]; then
    echo "$problems"
    return 1
  fi
}

# summarize_problems <lines> -- the first few of check_install's lines, on one line.
summarize_problems() {
  printf '%s\n' "$1" | awk 'NR <= 3 { out = out (NR > 1 ? "; " : "") $0 }
                            END { if (NR > 3) out = out "; and " NR - 3 " more"; print out }'
}

# install_verified_archive [--exclude <dir>]... [--after <function>] [--source <source>] <label> <url> <sha256> <dest>
# -- install the archive at <url> into <dest>, unless the install there is intact and from that archive.
# The archive must match <sha256>; it is extracted beside the current install (an archive holding one
# directory gives its contents), <function> runs on the result with its path, its manifest is
# written, and only then are the two swapped, so a failure at any step leaves the current install as
# it was. --source names what it was installed from when that is more than the archive.
install_verified_archive() {
  local -a exclude=()
  local after="" source=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --exclude) exclude+=("$2"); shift 2 ;;
      --after) after="$2"; shift 2 ;;
      --source) source="$2"; shift 2 ;;
      *) break ;;
    esac
  done
  local label="$1" url="$2" sha256="$3" dest="$4"
  source="${source:-$sha256}"

  local problems
  if [ -e "$dest" ]; then
    if problems="$(check_install "$dest" "$source")"; then
      echo "✅ $label is already installed at $dest and intact."
      return 0
    fi
    echo "Reinstalling $label: $(summarize_problems "$problems")"
  fi

  local parent name archive staging previous
  parent="$(dirname "$dest")"
  name="$(basename "$dest")"
  archive="$parent/$name.download"
  staging="$parent/$name.new"
  previous="$parent/$name.old"
  mkdir -p "$parent" || return 1

  echo "Downloading $label from $url ..."
  download_verified "$url" "$archive" "$sha256" || return 1
  echo "Checksum verified. Extracting $label ..."
  rm -rf "$staging"
  mkdir -p "$staging"
  if ! tar -xf "$archive" -C "$staging"; then
    echo "❌ ERROR: Failed to extract $label"
    rm -rf "$archive" "$staging"
    return 1
  fi
  rm -f "$archive"

  # An archive holding a single directory (node-v24.22.2-linux-x64/): its contents are the install.
  local -a entries
  shopt -s dotglob
  entries=("$staging"/*)
  shopt -u dotglob
  if [ ${#entries[@]} -eq 1 ] && [ -d "${entries[0]}" ]; then
    rm -rf "$staging.wrapper"
    if ! mv "$staging" "$staging.wrapper" ||
       ! mv "$staging.wrapper/$(basename "${entries[0]}")" "$staging"; then
      echo "❌ ERROR: Failed to unpack $label"
      rm -rf "$staging" "$staging.wrapper"
      return 1
    fi
    rm -rf "$staging.wrapper"
  fi

  if [ -n "$after" ] && ! "$after" "$staging"; then
    echo "❌ ERROR: Failed to prepare $label"
    rm -rf "$staging"
    return 1
  fi
  if ! write_install_manifest "$staging" "$source" ${exclude[@]+"${exclude[@]}"}; then
    echo "❌ ERROR: Failed to write the install manifest of $label"
    rm -rf "$staging"
    return 1
  fi

  rm -rf "$previous"
  if [ -e "$dest" ] && ! mv "$dest" "$previous"; then
    echo "❌ ERROR: Failed to move the previous $label aside"
    rm -rf "$staging"
    return 1
  fi
  if ! mv "$staging" "$dest"; then
    echo "❌ ERROR: Failed to move the new $label into place"
    if [ -e "$previous" ]; then mv "$previous" "$dest" || true; fi
    rm -rf "$staging"
    return 1
  fi
  rm -rf "$previous"
  echo "✅ $label installed at $dest"
}

# install_verified_file <label> <url> <sha256> <dest> -- download the single executable at <url> to
# <dest> unless the file there is intact and from that download. It must match <sha256>.
install_verified_file() {
  local label="$1" url="$2" sha256="$3" dest="$4" problems
  if [ -f "$dest" ]; then
    if problems="$(check_install "$dest" "$sha256")"; then
      echo "✅ $label is already installed at $dest and intact."
      return 0
    fi
    echo "Reinstalling $label: $(summarize_problems "$problems")"
  fi
  mkdir -p "$(dirname "$dest")" || return 1
  echo "Downloading $label from $url ..."
  download_verified "$url" "$dest.download" "$sha256" || return 1
  chmod +x "$dest.download"
  if ! mv -f "$dest.download" "$dest" || ! write_install_manifest "$dest" "$sha256"; then
    echo "❌ ERROR: Failed to install $label at $dest"
    rm -f "$dest.download"
    return 1
  fi
  echo "✅ Checksum verified. $label installed at $dest"
}
