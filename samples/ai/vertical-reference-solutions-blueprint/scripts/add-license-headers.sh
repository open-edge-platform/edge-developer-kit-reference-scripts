#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

COPYRIGHT_LINE="Copyright (C) 2026 Intel Corporation"
SPDX_LINE="SPDX-License-Identifier: Apache-2.0"
SPDX_MARKER="SPDX-License-Identifier:"
SCAN_LINES=20

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="apply"

usage() {
  cat <<'EOF'
Usage: scripts/add-license-headers.sh [--check|--dry-run] [path ...]

Adds the Intel Apache-2.0 license header to every source file that can carry a
comment, using the comment syntax of each file type.

  --check     report files missing the header and exit 1 (CI gate)
  --dry-run   report what would change, write nothing
  path ...    limit to these files/directories (default: whole repo)

Files already carrying an SPDX-License-Identifier are left untouched, as are
formats with no comment syntax (json, lock, csv), prose (md), and binaries.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE="check"; shift ;;
    --dry-run|-n) MODE="dry-run"; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; break ;;
    -*) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
    *) break ;;
  esac
done

comment_style() {
  local file="$1" base ext
  base="$(basename -- "$file")"
  ext="${base##*.}"
  [ "$ext" = "$base" ] && ext=""

  case "$base" in
    Makefile|makefile|GNUmakefile|Dockerfile|Dockerfile.*|.gitignore|.dockerignore|.npmrc|.editorconfig|.env|.env.*) echo hash; return 0 ;;
    .gitattributes|.gitmodules) echo hash; return 0 ;;
  esac

  case "$(printf '%s' "$ext" | tr '[:upper:]' '[:lower:]')" in
    sh|bash|zsh|ps1|psm1|psd1|py|yaml|yml|toml|cfg|conf|dockerfile|gitignore|properties|tf|rb|pl|r) echo hash ;;
    ts|tsx|js|jsx|mjs|cjs|mts|cts|rs|go|c|h|cc|cpp|hpp|java|kt|swift|scss|sass|less|proto|dart) echo slash ;;
    css) echo block ;;
    html|htm|xml|svg|xhtml|vue) echo xml ;;
    bat|cmd) echo rem ;;
    ini) echo semicolon ;;
    sql) echo dashes ;;
    *) return 1 ;;
  esac
}

emit_header() {
  local style="$1" eol="$2"
  case "$style" in
    hash)      printf '# %s%s\n# %s%s\n' "$COPYRIGHT_LINE" "$eol" "$SPDX_LINE" "$eol" ;;
    slash)     printf '// %s%s\n// %s%s\n' "$COPYRIGHT_LINE" "$eol" "$SPDX_LINE" "$eol" ;;
    block)     printf '/*%s\n * %s%s\n * %s%s\n */%s\n' "$eol" "$COPYRIGHT_LINE" "$eol" "$SPDX_LINE" "$eol" "$eol" ;;
    xml)       printf '<!-- %s -->%s\n<!-- %s -->%s\n' "$COPYRIGHT_LINE" "$eol" "$SPDX_LINE" "$eol" ;;
    rem)       printf 'REM %s%s\nREM %s%s\n' "$COPYRIGHT_LINE" "$eol" "$SPDX_LINE" "$eol" ;;
    semicolon) printf '; %s%s\n; %s%s\n' "$COPYRIGHT_LINE" "$eol" "$SPDX_LINE" "$eol" ;;
    dashes)    printf -- '-- %s%s\n-- %s%s\n' "$COPYRIGHT_LINE" "$eol" "$SPDX_LINE" "$eol" ;;
  esac
}

# Shebang, @echo off, doctype, @charset and #Requires must stay above the header.
preamble_len() {
  local file="$1" style="$2" count=0 line stripped
  local -a head_lines=()
  mapfile -t -n 8 head_lines < "$file"
  for line in "${head_lines[@]}"; do
    stripped="${line%$'\r'}"
    case "$stripped" in
      '#!'*) count=$((count + 1)); continue ;;
    esac
    if [ "$style" = rem ] && [ "$count" -eq 0 ]; then
      case "$stripped" in
        @*) count=$((count + 1)); continue ;;
      esac
    fi
    if [ "$style" = hash ]; then
      case "$stripped" in
        '#Requires'*|'#requires'*) count=$((count + 1)); continue ;;
      esac
    fi
    if [ "$style" = xml ]; then
      case "$stripped" in
        '<?xml'*|'<!doctype'*|'<!DOCTYPE'*) count=$((count + 1)); continue ;;
      esac
    fi
    if [ "$style" = block ] || [ "$style" = slash ]; then
      case "$stripped" in
        '@charset'*) count=$((count + 1)); continue ;;
      esac
    fi
    break
  done
  printf '%s' "$count"
}

is_excluded() {
  case "$1" in
    */node_modules/*|node_modules/*) return 0 ;;
    */.next/*|.next/*|*/dist/*|dist/*|*/build/*|*/out/*|*/target/*) return 0 ;;
    */.venv/*|.venv/*|*/__pycache__/*) return 0 ;;
    *.min.js|*.min.css|*.d.ts) return 0 ;;
    */importMap.js|*/payload-types.ts) return 0 ;;
    *) return 1 ;;
  esac
}

has_header() {
  head -n "$SCAN_LINES" -- "$1" | grep -qF "$SPDX_MARKER"
}

add_header() {
  local file="$1" style="$2" eol="$3" skip="$4" tmp next
  tmp="$(mktemp "${TMPDIR:-/tmp}/lic.XXXXXX")"
  if [ "$skip" -gt 0 ]; then
    head -n "$skip" -- "$file" >> "$tmp"
  fi
  emit_header "$style" "$eol" >> "$tmp"
  next="$(tail -n "+$((skip + 1))" -- "$file" | head -n 1 || true)"
  if [ -n "${next%$'\r'}" ]; then
    printf '%s\n' "$eol" >> "$tmp"
  fi
  tail -n "+$((skip + 1))" -- "$file" >> "$tmp"
  cat -- "$tmp" > "$file"
  rm -f -- "$tmp"
}

cd "$ROOT"

declare -a files=()
if [ $# -gt 0 ]; then
  mapfile -t files < <(git ls-files --cached --others --exclude-standard -z -- "$@" | tr '\0' '\n')
else
  mapfile -t files < <(git ls-files --cached --others --exclude-standard -z | tr '\0' '\n')
fi

changed=0
missing=0
skipped=0

for file in "${files[@]}"; do
  [ -n "$file" ] || continue
  [ -f "$file" ] || continue
  is_excluded "$file" && continue
  style="$(comment_style "$file")" || { skipped=$((skipped + 1)); continue; }
  grep -Iq . -- "$file" 2>/dev/null || continue
  [ -s "$file" ] || continue
  has_header "$file" && continue

  case "$MODE" in
    check)
      echo "missing header: $file"
      missing=$((missing + 1))
      ;;
    dry-run)
      echo "would add ($style): $file"
      changed=$((changed + 1))
      ;;
    apply)
      eol=""
      IFS= read -r first < "$file" || first=""
      case "$first" in
        *$'\r') eol=$'\r' ;;
      esac
      add_header "$file" "$style" "$eol" "$(preamble_len "$file" "$style")"
      echo "added ($style): $file"
      changed=$((changed + 1))
      ;;
  esac
done

case "$MODE" in
  check)
    if [ "$missing" -gt 0 ]; then
      echo "$missing file(s) missing the license header; run scripts/add-license-headers.sh" >&2
      exit 1
    fi
    echo "all eligible files carry the license header"
    ;;
  dry-run) echo "$changed file(s) would change, $skipped skipped (no comment syntax)" ;;
  apply)   echo "$changed file(s) updated, $skipped skipped (no comment syntax)" ;;
esac
