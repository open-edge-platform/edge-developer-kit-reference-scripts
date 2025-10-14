#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 

set -euo pipefail

TTS_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TTS_VENV_DIR="$TTS_SCRIPT_DIR/.venv"

# Repo info for kokoro
REPO_URL="https://github.com/hexgrad/kokoro.git"
# specific commit hash to fetch (from the tree URL provided)
REPO_COMMIT="dfb907a02bba8152ca444717ca5d78747ccb4bec"
DEST_DIR="$TTS_SCRIPT_DIR/kokoro"

check_uv_installed() {
    echo -e "Checking if uv is installed in workers thirdparty directory..."
    PARENT_UV_PATH="$(dirname "$(dirname "$PWD")")/thirdparty/uv/uv"
    if [ -x "$PARENT_UV_PATH" ]; then
        echo -e "Found uv in workers thirdparty folder."
        UV_CMD="$PARENT_UV_PATH"
    else
        echo -e "uv not found in expected location: $PARENT_UV_PATH"
        echo -e "Please ensure the workers setup has been run first."
        exit 1
    fi
}

create_venv() {
    if [[ -d "$TTS_VENV_DIR" ]]; then
        echo "Virtual environment already exists at $TTS_VENV_DIR."
    else
        echo "Creating Python 3.11 virtual environment with uv ..."
        "$UV_CMD" venv --seed --python 3.11 "$TTS_VENV_DIR"
    fi
    # shellcheck disable=SC1091
    source "$TTS_VENV_DIR/bin/activate"
    "$UV_CMD" sync
    "$UV_CMD" run python -m ensurepip
}

clone_kokoro_repo() {
    echo "Preparing kokoro at $DEST_DIR"

    if command -v git >/dev/null 2>&1; then
        echo "git found"
    else
        echo "git is required but not installed. Please install git and rerun this script."
        exit 1
    fi

    if [[ -d "$DEST_DIR" && -n "$(ls -A "$DEST_DIR")" ]]; then
        echo "Destination $DEST_DIR already exists and is not empty. Skipping clone."
        return 0
    fi

    # Initialize a repository and fetch only the specific commit (shallow)
    echo "Cloning specific commit $REPO_COMMIT from $REPO_URL into $DEST_DIR"
    git init "$DEST_DIR"
    pushd "$DEST_DIR" >/dev/null
    git remote add origin "$REPO_URL"

    # Try to fetch the specific commit shallowly. If that fails, fall back to a shallow branch fetch.
    if git fetch --depth 1 origin "$REPO_COMMIT"; then
        git checkout FETCH_HEAD
    else
        echo "Warning: could not fetch commit $REPO_COMMIT directly. Falling back to shallow clone of default branch."
        git fetch --depth 1 origin
        git checkout --detach FETCH_HEAD || git checkout --force
    fi

    # If a local patch file exists next to this script, attempt to apply it now
    PATCH_FILE="$TTS_SCRIPT_DIR/kokoro.patch"
    if [[ -f "$PATCH_FILE" ]]; then
        echo "Applying local patch: $PATCH_FILE"
        if git apply --whitespace=fix "$PATCH_FILE"; then
            git add -A
            # Try to commit; if commit fails (e.g. no changes), continue
            git commit -m "Apply local kokoro.patch" --author="Edge AI Studio <no-reply@local>" || true
            echo "Patch applied and committed."
        else
            echo "git apply failed; attempting git am fallback..."
            # git am expects an email-style patch. Try it as a fallback. If it fails, abort and exit to avoid pruning useful files.
            if git am --signoff < "$PATCH_FILE"; then
                echo "Patch applied via git am."
            else
                echo "ERROR: Failed to apply patch $PATCH_FILE. Aborting setup so the repository isn't pruned incorrectly."
                git am --abort >/dev/null 2>&1 || true
                popd >/dev/null
                exit 1
            fi
        fi
    else
        echo "No local patch file found at $PATCH_FILE; skipping patch step."
    fi

    # Remove everything except the kokoro folder
    echo "Pruning repository: keeping only the 'kokoro' folder"
    # Use a safe loop that handles dotfiles and ordinary files
    for entry in .?* *; do
        # skip current and parent dir
        [ "$entry" = "." ] && continue
        [ "$entry" = ".." ] && continue
        [ "$entry" = "kokoro" ] && continue
        rm -rf -- "$entry" || true
    done

    # If the repo produced a nested kokoro folder (DEST_DIR/kokoro), move its contents up
    if [[ -d "kokoro" ]]; then
        echo "Moving contents of inner 'kokoro' up into $DEST_DIR"
        # include dotfiles and avoid literal pattern expansion when empty
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

    # Optionally remove .git to leave only the kokoro content in the folder structure
    if [[ -d ".git" ]]; then
        rm -rf .git
    fi

    popd >/dev/null
    echo "kokoro prepared at $DEST_DIR (kokoro files at top level)"
}

main() {
    echo "Starting setup for Kokoro FastAPI with Intel GPU support ..."
    cd "$TTS_SCRIPT_DIR"
    check_uv_installed
    create_venv
    clone_kokoro_repo
    echo "Setup completed successfully!"
}

main