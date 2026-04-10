#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKERS_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKERS_THIRDPARTY_DIR="$WORKERS_DIR/thirdparty"

UV_PATH="$WORKERS_THIRDPARTY_DIR/uv/uv"

REPO_URL="https://github.com/hexgrad/kokoro.git"
REPO_COMMIT="dfb907a02bba8152ca444717ca5d78747ccb4bec"
DEST_DIR="$SCRIPT_DIR/kokoro"

check_uv() {
    if [ -x "$UV_PATH" ]; then
        echo "Found uv."
        return 0
    fi
    echo "ERROR: uv not found at $UV_PATH"
    echo "Please run the workers setup script first."
    exit 1
}

clone_kokoro_repo() {
    echo "Preparing kokoro at $DEST_DIR..."

    if ! command -v git >/dev/null 2>&1; then
        echo "ERROR: git is required but not installed."
        exit 1
    fi

    if [[ -d "$DEST_DIR" && -n "$(ls -A "$DEST_DIR")" ]]; then
        echo "Destination $DEST_DIR already exists. Skipping clone."
        return 0
    fi

    echo "Cloning commit $REPO_COMMIT from $REPO_URL..."
    git init "$DEST_DIR"
    pushd "$DEST_DIR" >/dev/null
    git remote add origin "$REPO_URL"

    if git fetch --depth 1 origin "$REPO_COMMIT"; then
        git checkout FETCH_HEAD
    else
        echo "Warning: could not fetch commit directly. Falling back to shallow clone."
        git fetch --depth 1 origin
        git checkout --detach FETCH_HEAD || git checkout --force
    fi

    PATCH_FILE="$SCRIPT_DIR/kokoro.patch"
    if [[ -f "$PATCH_FILE" ]]; then
        echo "Applying local patch: $PATCH_FILE"
        if git apply --whitespace=fix "$PATCH_FILE"; then
            git add -A
            git commit -m "Apply local kokoro.patch" --author="Edge AI Studio <no-reply@local>" || true
            echo "Patch applied and committed."
        else
            echo "git apply failed; attempting git am fallback..."
            if git am --signoff < "$PATCH_FILE"; then
                echo "Patch applied via git am."
            else
                echo "ERROR: Failed to apply patch. Aborting."
                git am --abort >/dev/null 2>&1 || echo "WARNING: Could not abort git am"
                popd >/dev/null
                exit 1
            fi
        fi
    else
        echo "No local patch file found; skipping patch step."
    fi

    echo "Pruning repository: keeping only the 'kokoro' folder..."
    for entry in .?* *; do
        [ "$entry" = "." ] && continue
        [ "$entry" = ".." ] && continue
        [ "$entry" = "kokoro" ] && continue
        rm -rf -- "$entry" || echo "WARNING: Failed to remove $entry"
    done

    if [[ -d "kokoro" ]]; then
        echo "Moving kokoro contents to top level..."
        shopt -s dotglob nullglob
        kokoro_entries=(kokoro/*)
        if (( ${#kokoro_entries[@]} )); then
            mv -f "${kokoro_entries[@]}" . || true
        fi
        shopt -u dotglob nullglob
        rm -rf kokoro
    else
        echo "Warning: expected 'kokoro' directory not found in fetched repo."
    fi

    [[ -d ".git" ]] && rm -rf .git

    popd >/dev/null
    echo "Kokoro prepared at $DEST_DIR."
}

main() {
    echo "Starting Kokoro setup..."
    cd "$SCRIPT_DIR"
    check_uv
    clone_kokoro_repo
    echo "Kokoro setup completed successfully!"
}

main