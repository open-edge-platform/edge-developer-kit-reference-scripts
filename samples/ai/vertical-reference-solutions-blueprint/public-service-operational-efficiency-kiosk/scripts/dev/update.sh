#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Mirror this checkout into another directory (a working copy on a test
# machine, a USB stick, a staging tree): empty the target, then copy over
# every file git does not ignore — minus .git and .claude.
#
#   scripts/dev/update.sh /path/to/target       ask, then wipe and copy
#   scripts/dev/update.sh --dry-run /path/...   list what would happen
#   scripts/dev/update.sh -y /path/...          no questions
#
# See docs/dev-mode.md.

# shellcheck source=../common.sh disable=SC1091
. "$(cd "$(dirname "$0")" && pwd)/../common.sh"

DRY=0 YES=0 ALL=0 TARGET=""
KEEP=(.git .claude)

usage() {
  cat <<EOF
Usage: scripts/dev/update.sh [options] <target-dir>

Replaces the contents of <target-dir> with this checkout. The file list is
everything git tracks plus everything untracked that .gitignore does not
exclude — so build output, node_modules, databases and local config never
travel. .git, .claude and the update scripts themselves are excluded from the
copy; .git and .claude are, by default, left alone in the target too.

The target is created if it does not exist. It may not be this checkout, or
contain it.

Options:
  --keep <name>  also keep this top-level entry in the target (repeatable)
  --all          empty the target completely, .git and .claude included
  --dry-run      print what would be removed and copied, change nothing
  -y, --yes      do not ask before emptying the target
  -h, --help     this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --keep) [ $# -ge 2 ] || die "--keep needs a name"; KEEP+=("$2"); shift ;;
    --all) ALL=1 ;;
    --dry-run) DRY=1 ;;
    -y|--yes) YES=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) usage; die "unknown option: $1" ;;
    *) [ -z "$TARGET" ] || die "one target directory at a time (got '$TARGET' and '$1')"; TARGET="$1" ;;
  esac
  shift
done

[ -n "$TARGET" ] || { usage; die "no target directory given"; }
[ "$ALL" -eq 0 ] || KEEP=()

git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1 ||
  die "$REPO_ROOT is not a git checkout — the file list comes from git"

# Absolute, symlink-free, without creating anything: the guards below have to
# run before the target exists, not after.
resolve_path() {
  local path="$1" tail=""
  case "$path" in /*) ;; *) path="$PWD/$path" ;; esac
  while [ ! -d "$path" ]; do
    tail="/$(basename "$path")$tail"
    path="$(dirname "$path")"
  done
  path="$(cd "$path" && pwd -P)"
  printf '%s' "${path%/}$tail"
}
TARGET="$(resolve_path "$TARGET")"
SOURCE="$(cd "$REPO_ROOT" && pwd -P)"

# The target gets emptied, so a bad path here is unrecoverable.
case "$TARGET" in
  "/"|"$HOME") die "refusing to empty $TARGET" ;;
esac
[ "$TARGET" != "$SOURCE" ] || die "the target is this checkout"
case "$TARGET/" in "$SOURCE"/*) die "the target is inside this checkout: $TARGET" ;; esac
case "$SOURCE/" in "$TARGET"/*) die "the target contains this checkout: $TARGET" ;; esac

mkdir -p "$TARGET" || die "cannot create $TARGET"

kept() {
  local entry="$1" name
  for name in ${KEEP[@]+"${KEEP[@]}"}; do
    [ "$entry" != "$name" ] || return 0
  done
  return 1
}

# Tracked plus untracked-but-not-ignored: what a clean clone of this working
# tree would hold. NUL-delimited, so odd filenames survive.
FILES=()
while IFS= read -r -d '' file; do
  case "$file" in
    .git|.git/*|.claude|.claude/*) continue ;;
    # The update tooling stays behind: it belongs to this checkout, not to the
    # copy it makes. Both platforms' entry points, so the target comes out the
    # same whichever one ran.
    scripts/dev/update.sh|scripts/dev/update.bat|scripts/win/update.ps1) continue ;;
  esac
  FILES+=("$file")
done < <(git -C "$SOURCE" ls-files -z --cached --others --exclude-standard)
[ "${#FILES[@]}" -gt 0 ] || die "git listed no files to copy"

REMOVE=()
while IFS= read -r -d '' entry; do
  entry="${entry#"$TARGET/"}"
  kept "$entry" || REMOVE+=("$entry")
done < <(find "$TARGET" -mindepth 1 -maxdepth 1 -print0)

info "Source  $SOURCE"
info "Target  $TARGET"
echo "    copy    ${#FILES[@]} files (git-tracked and untracked-not-ignored, minus .git, .claude and update.sh)"
if [ "${#REMOVE[@]}" -eq 0 ]; then
  echo "    remove  nothing — the target is empty"
else
  echo "    remove  ${#REMOVE[@]} entries from the target:"
  printf '              %s\n' "${REMOVE[@]}"
fi
[ "${#KEEP[@]}" -eq 0 ] || echo "    keep    ${KEEP[*]}"
echo

if [ "$DRY" -eq 1 ]; then
  info "--dry-run: nothing was removed or copied"
  exit 0
fi

if [ "${#REMOVE[@]}" -gt 0 ] && [ "$YES" -eq 0 ]; then
  [ -t 0 ] || die "not a terminal — re-run with --yes to confirm non-interactively"
  warn "everything listed above is deleted from $TARGET and is not recoverable"
  printf 'Proceed? [y/N] '
  read -r reply
  case "$reply" in y|Y|yes|YES) ;; *) die "aborted" ;; esac
fi

for entry in ${REMOVE[@]+"${REMOVE[@]}"}; do
  rm -rf -- "${TARGET:?}/$entry"
done
[ "${#REMOVE[@]}" -eq 0 ] || ok "emptied $TARGET"

# cp per file rather than a tar pipe: the list is explicit, and a missing
# source file (deleted after git listed it) stays a plain error.
for file in "${FILES[@]}"; do
  [ -e "$SOURCE/$file" ] || { warn "gone since git listed it, skipped: $file"; continue; }
  dir="$(dirname "$file")"
  [ "$dir" = "." ] || mkdir -p "$TARGET/$dir"
  cp -p -- "$SOURCE/$file" "$TARGET/$file"
done

ok "copied ${#FILES[@]} files to $TARGET"
