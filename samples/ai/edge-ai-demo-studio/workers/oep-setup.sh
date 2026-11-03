#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# oep-setup.sh - fetches the upstream source Demo Studio vendors at runtime, as listed in
# oep-services.json (keys in oep-services.schema.json); nothing upstream is committed.
# "services" (edge-ai-libraries microservices) share one pinned "tag" and sparse clone; each of the
# "sources" (plain git repositories) has its own. An entry's "subdir" is copied from the cache into
# a gitignored directory next to its worker, then its "patch" and <worker>/overlay/ are applied.
# A marker file in the copy names its ref; the copy is remade when the pin differs.
#
# Usage:
#   ./oep-setup.sh                 list catalogued services, sources, suite apps, custom workers
#   ./oep-setup.sh check           compare pins with the copies on disk;
#                                  exit 1 when one is missing or stale
#   ./oep-setup.sh fetch <worker>  copy every entry of <worker> at its pin if needed, apply patch/overlay
#   ./oep-setup.sh fetch --all     the same for every catalogued worker
#   ./oep-setup.sh info <worker>   show what the entries of <worker> resolve to
#   ./oep-setup.sh tag             print the pinned edge-ai-libraries tag
#   ./oep-setup.sh pin <tag>       rewrite "tag" (the edge-ai-libraries pin) in oep-services.json
#
# <worker> is a directory under workers/, e.g. services/speech-to-text/oep.
# EDGE_AI_LIBRARIES_REF=<tag> overrides the services' pin for one run. An entry's home_env variable,
# when set, names a local checkout of the upstream code, used as is and never fetched or removed.
# Needs python3 to read the JSON.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CATALOG_JSON="$SCRIPT_DIR/oep-services.json"
DEFAULT_REPO_URL="https://github.com/open-edge-platform/edge-ai-libraries.git"
# The one sparse clone every service's copy is made from.
OEP_LIBRARIES_CACHE_DIR="$SCRIPT_DIR/thirdparty/edge-ai-libraries"
# One sparse clone per plain git source lives under here.
SOURCES_CACHE_ROOT="$SCRIPT_DIR/thirdparty/git"
# Serialises fetches: several workers may start at once and share a cache.
LOCK_FILE="$SCRIPT_DIR/thirdparty/edge-ai-libraries.lock"
# Written into every copy with the ref it was made from.
SERVICE_REF_FILE_NAME=".demo-studio-edge-ai-libraries-ref"
SOURCE_REF_FILE_NAME=".demo-studio-source-ref"

usage() {
    sed -n '/^# Usage:/,/^#$/p' "$0" | sed 's/^# \{0,1\}//'
}

# ── Catalogue access ──────────────────────────────────────────────────

# Flatten oep-services.json into shlex-quoted lines, safe to re-split with `eval set --`: a header
# (repository= tag=), then one line of key=value tokens per entry, starting kind=service|source.
oep_read_catalog() {
    if ! command -v python3 >/dev/null 2>&1; then
        echo "ERROR: python3 is required to read $CATALOG_JSON." >&2
        return 1
    fi
    [ -f "$CATALOG_JSON" ] || { echo "ERROR: $CATALOG_JSON not found." >&2; return 1; }
    python3 - "$CATALOG_JSON" <<'PY'
import json, shlex, sys
path = sys.argv[1]
with open(path, encoding="utf-8") as fh:
    doc = json.load(fh)
service_keys = {"worker", "subdir", "name", "sentinel", "dir", "home_env", "tag", "install"}
source_keys = {"worker", "repository", "ref", "subdir", "name", "sentinel", "dir",
               "home_env", "patch", "patch_strip", "keep_root"}
# Validate everything before printing anything, so a bad file yields no output.
if not doc.get("tag"):
    sys.exit(f"ERROR: {path}: top-level \"tag\" is required")
lines = []
for index, svc in enumerate(doc.get("services", [])):
    unknown = set(svc) - service_keys
    if unknown:
        sys.exit(f"ERROR: {path}: services[{index}] has unknown keys: {', '.join(sorted(unknown))}")
    if not svc.get("worker") or not svc.get("subdir"):
        sys.exit(f"ERROR: {path}: services[{index}] needs \"worker\" and \"subdir\"")
    lines.append("kind=service " + " ".join(f"{k}={shlex.quote(str(v))}" for k, v in svc.items()))
for index, src in enumerate(doc.get("sources", [])):
    unknown = set(src) - source_keys
    if unknown:
        sys.exit(f"ERROR: {path}: sources[{index}] has unknown keys: {', '.join(sorted(unknown))}")
    for key in ("worker", "repository", "ref", "subdir"):
        if not src.get(key):
            sys.exit(f"ERROR: {path}: sources[{index}] needs \"{key}\"")
    lines.append("kind=source " + " ".join(f"{k}={shlex.quote(str(v).lower() if isinstance(v, bool) else str(v))}" for k, v in src.items()))
print("repository=%s tag=%s" % (shlex.quote(str(doc.get("repository", ""))), shlex.quote(str(doc["tag"]))))
print("\n".join(lines))
PY
}

# Populate CATALOG_REPO_URL, CATALOG_TAG and OEP_RECORDS (one flattened
# record per entry, services first). Cached after the first call.
oep_load_catalog() {
    [ -n "${CATALOG_TAG:-}" ] && return 0
    local lines header flattened
    local -a header_fields=()
    # Capture first so a failing read (bad JSON, unknown key) stops the script
    # instead of being swallowed by process substitution.
    flattened="$(oep_read_catalog)" || return 1
    mapfile -t lines <<< "$flattened"
    [ "${#lines[@]}" -ge 1 ] && [ -n "${lines[0]}" ] || return 1
    header="${lines[0]}"
    eval "header_fields=($header)"
    CATALOG_REPO_URL="${header_fields[0]#repository=}"
    CATALOG_TAG="${header_fields[1]#tag=}"
    [ -n "$CATALOG_REPO_URL" ] || CATALOG_REPO_URL="$DEFAULT_REPO_URL"
    OEP_RECORDS=("${lines[@]:1}")
}

# Load one flattened record into OEP_* variables (paths resolved).
oep_load_record() {
    local record="$1" token key value
    OEP_KIND="" OEP_WORKER="" OEP_NAME="" OEP_SUBDIR="" OEP_SENTINEL_REL="" OEP_DIR=""
    OEP_HOME_ENV="" OEP_TAG="" OEP_EXTERNAL="" OEP_REPO_URL="" OEP_PATCH="" OEP_PATCH_STRIP="1"
    OEP_KEEP_ROOT=""
    eval "set -- $record"
    for token in "$@"; do
        key="${token%%=*}"
        value="${token#*=}"
        case "$key" in
            kind)        OEP_KIND="$value" ;;
            worker)      OEP_WORKER="${value%/}" ;;
            name)        OEP_NAME="$value" ;;
            subdir)      OEP_SUBDIR="${value%/}" ;;
            sentinel)    OEP_SENTINEL_REL="$value" ;;
            dir)         OEP_DIR="$value" ;;
            home_env)    OEP_HOME_ENV="$value" ;;
            tag|ref)     OEP_TAG="$value" ;;
            repository)  OEP_REPO_URL="$value" ;;
            patch)       OEP_PATCH="$value" ;;
            patch_strip) OEP_PATCH_STRIP="$value" ;;
            keep_root)   [ "$value" = "true" ] && OEP_KEEP_ROOT=1 ;;
        esac
    done
    OEP_WORKER_DIR="$SCRIPT_DIR/$OEP_WORKER"
    OEP_NAME="${OEP_NAME:-$(basename "$OEP_SUBDIR")}"
    if [ "$OEP_KIND" = "service" ]; then
        OEP_REPO_URL="$CATALOG_REPO_URL"
        OEP_TAG="${EDGE_AI_LIBRARIES_REF:-${OEP_TAG:-$CATALOG_TAG}}"
        OEP_CACHE_DIR="$OEP_LIBRARIES_CACHE_DIR"
        OEP_REF_FILE_NAME="$SERVICE_REF_FILE_NAME"
        OEP_LABEL="OEP $OEP_NAME"
    else
        OEP_CACHE_DIR="$SOURCES_CACHE_ROOT/$OEP_NAME"
        OEP_REF_FILE_NAME="$SOURCE_REF_FILE_NAME"
        OEP_LABEL="source $OEP_NAME"
    fi

    # OEP_SRC_DIR is the flat copy the wrapper imports from (the catalogue's
    # "dir"), or the directory home_env points at.
    if [ -n "$OEP_HOME_ENV" ] && [ -n "${!OEP_HOME_ENV:-}" ]; then
        OEP_SRC_DIR="${!OEP_HOME_ENV}"
        OEP_EXTERNAL=1
    elif [ -n "$OEP_DIR" ]; then
        case "$OEP_DIR" in
            /*) OEP_SRC_DIR="$OEP_DIR" ;;
            *)  OEP_SRC_DIR="$OEP_WORKER_DIR/$OEP_DIR" ;;
        esac
    else
        OEP_SRC_DIR="$OEP_WORKER_DIR/thirdparty/$OEP_NAME"
    fi
    # Resolve ".." without requiring the copy itself to exist yet.
    mkdir -p "$(dirname "$OEP_SRC_DIR")"
    OEP_SRC_DIR="$(cd "$(dirname "$OEP_SRC_DIR")" && pwd)/$(basename "$OEP_SRC_DIR")"

    OEP_SENTINEL="$OEP_SRC_DIR${OEP_SENTINEL_REL:+/$OEP_SENTINEL_REL}"
    OEP_REF_FILE="$OEP_SRC_DIR/$OEP_REF_FILE_NAME"
    OEP_OVERLAY_DIR="$OEP_WORKER_DIR/overlay"
    OEP_PATCH_FILE="${OEP_PATCH:+$OEP_WORKER_DIR/$OEP_PATCH}"
    OEP_CACHE_APP_DIR="$OEP_CACHE_DIR/$OEP_SUBDIR"
}

# The records whose worker matches $1 (with or without trailing slash), one
# per line, into OEP_MATCHES. Fails when there is none.
oep_records_for_worker() {
    local wanted="${1%/}" record
    OEP_MATCHES=()
    for record in "${OEP_RECORDS[@]}"; do
        oep_load_record "$record"
        [ "$OEP_WORKER" = "$wanted" ] && OEP_MATCHES+=("$record")
    done
    [ "${#OEP_MATCHES[@]}" -gt 0 ] && return 0
    echo "ERROR: '$wanted' is not in $CATALOG_JSON. Catalogued workers:" >&2
    for record in "${OEP_RECORDS[@]}"; do
        oep_load_record "$record"
        echo "  $OEP_WORKER ($OEP_KIND $OEP_NAME)" >&2
    done
    return 1
}

# Ref the copy was made from (empty when there is no copy or no marker).
oep_checked_out_tag() {
    [ -f "$OEP_REF_FILE" ] || return 0
    tr -d '[:space:]' < "$OEP_REF_FILE"
}

# ── Cache ─────────────────────────────────────────────────────────────

oep_require_git() {
    command -v git >/dev/null 2>&1 && return 0
    echo "ERROR: git is required to fetch $OEP_LABEL." >&2
    echo "Install git (sudo apt-get install -y git) and try again." >&2
    return 1
}

# A 40-hex ref is a commit; anything else is taken as a tag.
oep_ref_is_commit() {
    [[ "$OEP_TAG" =~ ^[0-9a-f]{40}$ ]]
}

# Bring the existing cache to OEP_TAG with OEP_SUBDIR materialised. Fails
# (rather than repairing) when the clone is unusable; the caller re-clones.
oep_cache_update() {
    local git="git -C $OEP_CACHE_DIR" want
    $git remote set-url origin "$OEP_REPO_URL"
    if oep_ref_is_commit; then
        if ! $git cat-file -e "$OEP_TAG^{commit}" 2>/dev/null; then
            echo "Fetching $OEP_NAME $OEP_TAG into the cache..."
            $git fetch --quiet --depth 1 origin "$OEP_TAG"
        fi
        want="$OEP_TAG"
    else
        if ! $git rev-parse -q --verify "refs/tags/$OEP_TAG^{commit}" >/dev/null; then
            echo "Fetching $OEP_NAME $OEP_TAG into the cache..."
            $git fetch --quiet --depth 1 origin "refs/tags/$OEP_TAG:refs/tags/$OEP_TAG"
        fi
        want="refs/tags/$OEP_TAG"
    fi
    if [ "$($git rev-parse HEAD)" != "$($git rev-parse "$want^{commit}")" ]; then
        $git -c advice.detachedHead=false checkout --quiet --detach "$want"
    fi
    # Idempotent; grows the sparse checkout by this entry's directory.
    $git sparse-checkout add "$OEP_SUBDIR" >/dev/null
}

oep_cache_clone() {
    mkdir -p "$(dirname "$OEP_CACHE_DIR")"
    echo "Cloning $OEP_REPO_URL ($OEP_TAG) into the cache $OEP_CACHE_DIR..."
    if oep_ref_is_commit; then
        # A commit cannot be cloned with --branch: clone nothing, then fetch it.
        if ! git clone --quiet --no-checkout --filter=blob:none --sparse "$OEP_REPO_URL" "$OEP_CACHE_DIR" \
            || ! git -C "$OEP_CACHE_DIR" fetch --quiet --depth 1 origin "$OEP_TAG" \
            || ! git -C "$OEP_CACHE_DIR" sparse-checkout set "$OEP_SUBDIR" >/dev/null \
            || ! git -C "$OEP_CACHE_DIR" -c advice.detachedHead=false checkout --quiet --detach "$OEP_TAG"; then
            echo "ERROR: Failed to clone $OEP_REPO_URL at $OEP_TAG" >&2
            rm -rf "$OEP_CACHE_DIR"
            return 1
        fi
    elif ! git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$OEP_TAG" \
            --filter=blob:none --sparse "$OEP_REPO_URL" "$OEP_CACHE_DIR" \
        || ! git -C "$OEP_CACHE_DIR" sparse-checkout set "$OEP_SUBDIR" >/dev/null; then
        echo "ERROR: Failed to clone $OEP_REPO_URL at $OEP_TAG" >&2
        rm -rf "$OEP_CACHE_DIR"
        return 1
    fi
}

# Make sure the cache holds OEP_SUBDIR at OEP_TAG.
oep_ensure_cache() {
    oep_require_git || return 1
    local sentinel="$OEP_CACHE_APP_DIR${OEP_SENTINEL_REL:+/$OEP_SENTINEL_REL}"
    if [ -n "$OEP_KEEP_ROOT" ]; then
        sentinel="$OEP_CACHE_DIR${OEP_SENTINEL_REL:+/$OEP_SENTINEL_REL}"
    fi
    if [ -d "$OEP_CACHE_DIR/.git" ]; then
        # A clone stopped mid-checkout updates fine but has no files: as unusable as a failed update.
        if ! oep_cache_update || [ ! -e "$sentinel" ]; then
            echo "Cache $OEP_CACHE_DIR is unusable; re-cloning..."
            rm -rf "$OEP_CACHE_DIR"
            oep_cache_clone || return 1
        fi
    else
        [ -e "$OEP_CACHE_DIR" ] && { echo "Removing stale $OEP_CACHE_DIR (not a git checkout)..."; rm -rf "$OEP_CACHE_DIR"; }
        oep_cache_clone || return 1
    fi
    if [ ! -e "$sentinel" ]; then
        echo "ERROR: $OEP_SUBDIR is missing from $OEP_NAME $OEP_TAG (expected $sentinel)" >&2
        return 1
    fi
}

# ── Fetch ─────────────────────────────────────────────────────────────

# Copy OEP_SUBDIR from the cache into OEP_SRC_DIR, apply the patch and stamp the ref. keep_root also
# copies the repository's top-level files and keeps the subdir's path, for a pyproject.toml that
# takes the copy by path (setup.py + package directory).
oep_export() {
    if [ "$OEP_SRC_DIR" = "$OEP_CACHE_DIR" ] || [ "$OEP_SRC_DIR" = "$SCRIPT_DIR" ] || [ "$OEP_SRC_DIR" = "$OEP_WORKER_DIR" ]; then
        echo "ERROR: refusing to copy $OEP_NAME into $OEP_SRC_DIR" >&2
        return 1
    fi
    rm -rf "$OEP_SRC_DIR"
    mkdir -p "$OEP_SRC_DIR"
    echo "Copying $OEP_SUBDIR ($OEP_TAG) to $OEP_SRC_DIR..."
    if [ -n "$OEP_KEEP_ROOT" ]; then
        find "$OEP_CACHE_DIR" -mindepth 1 -maxdepth 1 -type f -exec cp {} "$OEP_SRC_DIR/" \;
        mkdir -p "$OEP_SRC_DIR/$(dirname "$OEP_SUBDIR")"
        cp -R "$OEP_CACHE_APP_DIR" "$OEP_SRC_DIR/$OEP_SUBDIR"
    else
        cp -R "$OEP_CACHE_APP_DIR/." "$OEP_SRC_DIR/"
    fi
    if [ ! -e "$OEP_SENTINEL" ]; then
        echo "ERROR: copy is incomplete (expected $OEP_SENTINEL)" >&2
        return 1
    fi
    if [ -n "$OEP_PATCH_FILE" ]; then
        if [ ! -f "$OEP_PATCH_FILE" ]; then
            echo "ERROR: patch $OEP_PATCH_FILE listed for $OEP_NAME does not exist" >&2
            return 1
        fi
        echo "Applying $(basename "$OEP_PATCH_FILE") to $OEP_SRC_DIR (-p$OEP_PATCH_STRIP)..."
        # Inside this repository `git apply` resolves paths against the repo root and silently skips
        # the rest; capping discovery at the copy's parent makes it act like patch(1) on plain files.
        if ! GIT_CEILING_DIRECTORIES="$(dirname "$OEP_SRC_DIR")" \
                git -C "$OEP_SRC_DIR" apply --whitespace=nowarn -p"$OEP_PATCH_STRIP" "$OEP_PATCH_FILE"; then
            echo "ERROR: $(basename "$OEP_PATCH_FILE") does not apply to $OEP_NAME $OEP_TAG" >&2
            return 1
        fi
    fi
    printf '%s\n' "$OEP_TAG" > "$OEP_REF_FILE"
    echo "$OEP_LABEL $OEP_TAG ready."
}

# Ensure OEP_SRC_DIR is the upstream code at OEP_TAG. Skipped when the copy
# on disk already carries that ref and is complete.
oep_ensure_upstream() {
    local current legacy
    if [ -n "$OEP_EXTERNAL" ]; then
        if [ ! -e "$OEP_SENTINEL" ]; then
            echo "ERROR: $OEP_HOME_ENV=$OEP_SRC_DIR does not contain $OEP_SUBDIR (expected $OEP_SENTINEL)" >&2
            return 1
        fi
        echo "$OEP_LABEL: using $OEP_SRC_DIR from \$$OEP_HOME_ENV (not fetched)."
        return 0
    fi
    # Per-worker sparse clones from older checkouts are unused.
    legacy="$OEP_WORKER_DIR/thirdparty/edge-ai-libraries"
    if [ "$legacy" != "$OEP_CACHE_DIR" ] && [ -d "$legacy/.git" ]; then
        echo "Removing the per-worker clone $legacy (replaced by $OEP_SRC_DIR)..."
        rm -rf "$legacy"
    fi
    current="$(oep_checked_out_tag)"
    if [ "$current" = "$OEP_TAG" ] && [ -e "$OEP_SENTINEL" ]; then
        echo "$OEP_LABEL already at $OEP_TAG."
        return 0
    fi
    if [ -e "$OEP_SRC_DIR" ]; then
        echo "$OEP_LABEL copy at $OEP_SRC_DIR is at '${current:-unknown}', want $OEP_TAG. Remaking..."
    fi
    oep_ensure_cache && oep_export
}

# Copy <worker>/overlay/ (overlay/<name>/ for a worker with several entries) onto the copy.
# Re-applied on every fetch, so an edited overlay takes effect without a re-fetch.
oep_apply_overlay() {
    local overlay="$OEP_OVERLAY_DIR"
    [ -d "$overlay/$OEP_NAME" ] && overlay="$overlay/$OEP_NAME"
    [ -d "$overlay" ] || return 0
    echo "Applying native overlay to $OEP_SRC_DIR:"
    ( cd "$overlay" && find . -type f | sed 's#^\./#  - #' )
    cp -R "$overlay/." "$OEP_SRC_DIR/"
}

oep_fetch_unlocked() {
    oep_ensure_upstream && oep_apply_overlay
}

# Workers starting at once share the caches, so a fetch holds a lock throughout (without flock,
# fetches run unserialised).
oep_fetch() {
    if command -v flock >/dev/null 2>&1; then
        mkdir -p "$(dirname "$LOCK_FILE")"
        (
            flock -w 900 9 || { echo "ERROR: timed out waiting for another oep-setup.sh to finish ($LOCK_FILE)" >&2; exit 1; }
            oep_fetch_unlocked
        ) 9>"$LOCK_FILE"
    else
        oep_fetch_unlocked
    fi
}

oep_info() {
    local overlay="$OEP_OVERLAY_DIR"
    [ -d "$overlay/$OEP_NAME" ] && overlay="$overlay/$OEP_NAME"
    cat <<EOF
worker:    $OEP_WORKER ($OEP_WORKER_DIR)
kind:      $OEP_KIND ($OEP_NAME)
upstream:  $OEP_REPO_URL
subdir:    $OEP_SUBDIR${OEP_KEEP_ROOT:+ (plus top-level repository files)}
ref:       $OEP_TAG${EDGE_AI_LIBRARIES_REF:+$([ "$OEP_KIND" = service ] && echo " (from EDGE_AI_LIBRARIES_REF)")}
source:    $OEP_SRC_DIR${OEP_EXTERNAL:+ (from \$$OEP_HOME_ENV, not fetched)}
cache:     $OEP_CACHE_DIR
on disk:   $(oep_checked_out_tag)
patch:     ${OEP_PATCH_FILE:-none}${OEP_PATCH_FILE:+ (-p$OEP_PATCH_STRIP)}
overlay:   $([ -d "$overlay" ] && find "$overlay" -type f | sed "s#^$overlay/##" | tr '\n' ' ' || echo none)
EOF
}

# ── Inventory ─────────────────────────────────────────────────────────

print_row() {
    printf '%-38s %-13s %-52s %-17s %-17s %s\n' "$@"
}

read_env_var() {
    local file="$1" key="$2" line
    [ -f "$file" ] || return 0
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%%#*}"; line="${line%$'\r'}"
        line="${line#"${line%%[![:space:]]*}"}"; line="${line%"${line##*[![:space:]]}"}"
        [[ "$line" == "$key="* ]] && { echo "${line#*=}"; return 0; }
    done < "$file"
    return 0
}

STALE=0

# One inventory row for the loaded record; flags it in check mode.
list_record_row() {
    local mode="$1" upstream="$2" current state overlay adaptation short
    state="ok"
    if [ -n "$OEP_EXTERNAL" ]; then
        current="(external)"
        [ -e "$OEP_SENTINEL" ] || state="MISSING"
    elif [ -e "$OEP_SENTINEL" ]; then
        current="$(oep_checked_out_tag)"
        [ "$current" = "$OEP_TAG" ] || state="STALE"
    else
        current="(not fetched)"
        state="MISSING"
    fi
    adaptation="none"
    overlay="$OEP_OVERLAY_DIR"
    [ -d "$overlay/$OEP_NAME" ] && overlay="$overlay/$OEP_NAME"
    [ -d "$overlay" ] && adaptation="overlay/ ($(find "$overlay" -type f | wc -l | tr -d ' ') files)"
    if [ -n "$OEP_PATCH_FILE" ]; then
        [ "$adaptation" = none ] && adaptation="$OEP_PATCH" || adaptation="$OEP_PATCH, $adaptation"
    fi
    short="$OEP_TAG"; [ "${#short}" -gt 12 ] && oep_ref_is_commit && short="${OEP_TAG:0:12}"
    print_row "$OEP_WORKER" "native" "$upstream" "$short" "$([ "${#current}" -gt 12 ] && [[ "$current" =~ ^[0-9a-f]{40}$ ]] && echo "${current:0:12}" || echo "$current")" "$adaptation"
    if [ "$mode" = "check" ] && [ "$state" != "ok" ]; then
        STALE=1
        printf '%-38s %s\n' "" ">> $state: expected $OEP_TAG at $OEP_SRC_DIR (run: $0 fetch $OEP_WORKER)"
    fi
}

cmd_list() {
    local mode="$1" record marker dir rel pinned subdir ref_file current

    echo "OEP microservices from edge-ai-libraries (catalogue: $CATALOG_JSON, tag: $CATALOG_TAG, cache: $OEP_LIBRARIES_CACHE_DIR)"
    echo
    print_row "worker" "runtime" "upstream" "pinned" "on disk" "native adaptation"
    print_row "------" "-------" "--------" "------" "-------" "-----------------"
    for record in "${OEP_RECORDS[@]}"; do
        oep_load_record "$record"
        [ "$OEP_KIND" = "service" ] || continue
        list_record_row "$mode" "edge-ai-libraries/$OEP_SUBDIR"
    done

    echo
    echo "Vendored git sources (catalogue \"sources\", one sparse clone each under $SOURCES_CACHE_ROOT)"
    echo
    print_row "worker" "runtime" "upstream" "pinned" "on disk" "native adaptation"
    print_row "------" "-------" "--------" "------" "-------" "-----------------"
    for record in "${OEP_RECORDS[@]}"; do
        oep_load_record "$record"
        [ "$OEP_KIND" = "source" ] || continue
        list_record_row "$mode" "$(echo "$OEP_REPO_URL" | sed -E 's#^https?://(www\.)?github\.com/##; s#\.git$##')/$OEP_SUBDIR"
    done

    echo
    echo "OEP suite apps from edge-ai-suites (suites/*/*/suite.env, docker compose, Linux only; EDGE_AI_SUITES_REF overrides)"
    echo
    while IFS= read -r marker; do
        dir="$(dirname "$marker")"; rel="${dir#"$SCRIPT_DIR"/}"
        pinned="$(read_env_var "$marker" EDGE_AI_SUITES_REF)"
        [ -n "$pinned" ] || continue
        subdir="$(read_env_var "$marker" EDGE_AI_SUITES_APP_PATH)"; [ -n "$subdir" ] || subdir="${rel#suites/}"
        ref_file="$dir/src/.demo-studio-edge-ai-suites-ref"
        if [ -f "$ref_file" ]; then current="$(tr -d '[:space:]' < "$ref_file")"; else current="(not cloned)"; fi
        print_row "$rel" "docker/linux" "edge-ai-suites/$subdir" "$pinned" "$current" "compose override at start"
        if [ "$mode" = "check" ] && [ "$current" != "$pinned" ]; then
            STALE=1
            printf '%-38s %s\n' "" ">> $([ -f "$ref_file" ] && echo STALE || echo MISSING): expected $pinned in $ref_file"
        fi
    done < <(find "$SCRIPT_DIR/suites" -mindepth 3 -maxdepth 3 -name suite.env 2>/dev/null | sort)

    echo
    echo "Custom workers (not catalogued; code lives in this repository):"
    # Workers live at services/<name>, services/<group>/<backend> and
    # engines/<name>; a directory is a worker when it has a start script.
    local name catalogued
    while IFS= read -r dir; do
        dir="$(dirname "$dir")"; name="${dir#"$SCRIPT_DIR"/}"
        catalogued=0
        for record in "${OEP_RECORDS[@]}"; do
            oep_load_record "$record"
            [ "$OEP_WORKER" = "$name" ] && catalogued=1
        done
        [ "$catalogued" -eq 0 ] || continue
        printf '  %s\n' "$name"
    done < <(find "$SCRIPT_DIR/services" "$SCRIPT_DIR/engines" -mindepth 2 -maxdepth 3 -name start.sh -not -path '*/thirdparty/*' 2>/dev/null | sort)

    if [ "$mode" = "check" ]; then
        echo
        if [ "$STALE" -ne 0 ]; then
            echo "Some copies are missing or not at their pinned ref."
            return 1
        fi
        echo "All copies match their pins."
    fi
}

cmd_pin() {
    local tag="${1:-}"
    if [ -z "$tag" ]; then
        echo "ERROR: pin needs a tag, e.g. $0 pin 2026.2.1" >&2
        exit 64
    fi
    python3 - "$CATALOG_JSON" "$tag" <<'PY'
import json, sys
path, tag = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as fh:
    doc = json.load(fh)
doc["tag"] = tag
with open(path, "w", encoding="utf-8") as fh:
    json.dump(doc, fh, indent=2)
    fh.write("\n")
PY
    echo "tag is now $tag in $CATALOG_JSON. Run '$0 fetch --all' (or start each worker) to remake the copies."
}

# ── Entry point ───────────────────────────────────────────────────────

MODE="${1:-list}"
case "$MODE" in
    -h|--help|help)
        usage; exit 0 ;;
esac
oep_load_catalog
case "$MODE" in
    list|check)
        cmd_list "$MODE" ;;
    fetch)
        if [ "${2:-}" = "--all" ]; then
            for record in "${OEP_RECORDS[@]}"; do
                oep_load_record "$record"
                oep_fetch
            done
        else
            [ -n "${2:-}" ] || { echo "ERROR: fetch needs a worker name or --all" >&2; usage >&2; exit 64; }
            oep_records_for_worker "$2"
            for record in "${OEP_MATCHES[@]}"; do
                oep_load_record "$record"
                oep_fetch
            done
        fi ;;
    info)
        [ -n "${2:-}" ] || { echo "ERROR: info needs a worker name" >&2; exit 64; }
        oep_records_for_worker "$2"
        for record in "${OEP_MATCHES[@]}"; do
            oep_load_record "$record"
            oep_info
            echo
        done ;;
    tag)
        echo "${EDGE_AI_LIBRARIES_REF:-$CATALOG_TAG}" ;;
    pin)
        cmd_pin "${2:-}" ;;
    *)
        echo "Unknown command: $MODE" >&2; usage >&2; exit 64 ;;
esac
