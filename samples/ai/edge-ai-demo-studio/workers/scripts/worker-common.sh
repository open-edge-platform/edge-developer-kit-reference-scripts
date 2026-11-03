#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Shared helpers for worker start scripts. Source it with this bootstrap, which works at any nesting depth:
#
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   WORKERS_ROOT="$SCRIPT_DIR"
#   while [ ! -f "$WORKERS_ROOT/scripts/worker-common.sh" ]; do WORKERS_ROOT="$(dirname "$WORKERS_ROOT")"; done
#   . "$WORKERS_ROOT/scripts/worker-common.sh"

if [ -z "${WORKERS_ROOT:-}" ]; then
    WORKERS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

THIRDPARTY_DIR="$WORKERS_ROOT/thirdparty"
UV_CMD="$THIRDPARTY_DIR/uv/uv"
OVMS_DIR="$THIRDPARTY_DIR/ovms"
OVMS_PATH="$OVMS_DIR/bin/ovms"
# The optimum-cli environment `ovms --pull` converts with, synced on the first OVMS worker start.
OVMS_EXPORT_VENV="$WORKERS_ROOT/common/ovms-export/.venv"
# FFmpeg and git come from the project-root setup, one level above workers/.
PROJECT_ROOT="$(cd "$WORKERS_ROOT/.." && pwd)"
ROOT_THIRDPARTY_DIR="$PROJECT_ROOT/thirdparty"
FFMPEG_DIR="$ROOT_THIRDPARTY_DIR/ffmpeg"
FFMPEG_PATH="$FFMPEG_DIR/bin/ffmpeg"
GIT_PATH="$ROOT_THIRDPARTY_DIR/git/cmd/git"
MODELS_DIR="$PROJECT_ROOT/models"
# One Hugging Face cache for every worker and what it runs, inside models/ so "Clear model cache"
# reaches it; an HF_HOME already set (deployment, CI) wins. Mirrors worker_common.hf_home().
if [ -z "${HF_HOME:-}" ]; then
    # Keep reading the token `hf auth login` saved under the default HF_HOME.
    HF_TOKEN_PATH="${HF_TOKEN_PATH:-${XDG_CACHE_HOME:-$HOME/.cache}/huggingface/token}"
    export HF_TOKEN_PATH
    HF_HOME="$MODELS_DIR/huggingface"
fi

export WORKERS_ROOT PROJECT_ROOT THIRDPARTY_DIR UV_CMD OVMS_DIR OVMS_PATH OVMS_EXPORT_VENV
export ROOT_THIRDPARTY_DIR FFMPEG_DIR FFMPEG_PATH GIT_PATH MODELS_DIR HF_HOME

# _require <path> <label>
_require() {
    local target="$1" label="$2"
    if [ -x "$target" ]; then return 0; fi
    echo "ERROR: $label not found at $target" >&2
    echo "Please run the workers setup script first (workers/setup.sh)." >&2
    exit 1
}

# startup_event <json> -- a report for the app's startup panel (worker_common/startup.py), printed
# only when EDGE_AI_STUDIO_STARTUP_EVENTS is set. Callers pass fixed JSON text.
startup_event() {
    case "${EDGE_AI_STUDIO_STARTUP_EVENTS:-}" in ""|0) return 0 ;; esac
    printf '\nEDGE_AI_STUDIO_STARTUP %s\n' "$1"
}

require_uv()     { _require "$UV_CMD" "uv"; }
require_ovms()   { _require "$OVMS_PATH" "OVMS"; }
require_ffmpeg() { _require "$FFMPEG_PATH" "FFmpeg"; }

# python_has_modules <python> <module>... -- whether that interpreter finds every module. A partial
# install leaves the interpreter and entry points without the packages, so check packages, not files.
# find_spec doesn't import (torch takes seconds); -I keeps PYTHONPATH and cwd out.
python_has_modules() {
    local python="$1"; shift
    [ -x "$python" ] || return 1
    "$python" -I -c "import importlib.util, sys; sys.exit(any(importlib.util.find_spec(m) is None for m in sys.argv[1:]))" "$@" >/dev/null 2>&1
}

# git_cmd -- the bundled git if setup installed one, else git on PATH.
git_cmd() {
    if [ -x "$GIT_PATH" ]; then echo "$GIT_PATH"; return 0; fi
    if command -v git >/dev/null 2>&1; then echo "git"; return 0; fi
    echo "ERROR: git not found. Please run the project setup script first." >&2
    exit 1
}

# oep_fetch <worker> -- fetch what oep-services.json pins for <worker> (e.g. services/speech-to-text/oep),
# with its patch and overlay/ applied. Cheap and idempotent, so call it on every start. See oep-setup.sh.
oep_fetch() {
    "$WORKERS_ROOT/oep-setup.sh" fetch "$1"
}

# Install only this worker into the shared environment: --inexact keeps other workers' packages;
# --frozen uses the committed lock without needing unrelated vendored sources (malaya) to exist yet.
prepare_worker() {
    require_uv
    local project_file="$SCRIPT_DIR/pyproject.toml"
    [ -f "$project_file" ] || { echo "ERROR: Missing $project_file" >&2; return 1; }
    local package
    package="$(sed -n 's/^name = "\([^"]*\)".*/\1/p' "$project_file" | head -1)"
    [ -n "$package" ] || { echo "ERROR: No project name in $project_file" >&2; return 1; }

    # A first start installs everything (minutes for a torch worker); later ones only check.
    startup_event '{"event":"stage","stage":"preparing","detail":"Installing dependencies"}'

    # The shared OEP model-download source is fetched only for workers that need model-downloader.
    if grep -q '"model-downloader' "$project_file"; then
        if ! oep_fetch common/downloader; then
            startup_event '{"event":"failure","summary":"Could not fetch the model downloader sources"}'
            return 1
        fi
    fi

    echo "Preparing $package..."
    local synced=0
    # A worker excluded from the workspace keeps its own uv.lock and venv; members share workers/uv.lock.
    if [ -f "$SCRIPT_DIR/uv.lock" ]; then
        "$UV_CMD" sync --frozen --project "$SCRIPT_DIR" || synced=$?
    else
        "$UV_CMD" sync --frozen --inexact --project "$WORKERS_ROOT" --package "$package" || synced=$?
    fi
    if [ "$synced" -ne 0 ]; then
        startup_event '{"event":"failure","summary":"Could not install the worker dependencies (uv sync failed)"}'
        return 1
    fi
    startup_event '{"event":"stage-end","stage":"preparing"}'
}

# ovms_prepare -- provision the shared OVMS conversion environment and the binary's template deps.
ovms_prepare() {
    require_uv
    require_ovms
    local ovms_lib_python="$OVMS_DIR/lib/python"
    if [ ! -d "$ovms_lib_python/jinja2" ] || [ ! -d "$ovms_lib_python/markupsafe" ]; then
        echo "Installing Jinja2 and MarkupSafe into OVMS lib/python..."
        if ! "$UV_CMD" pip install --target "$ovms_lib_python" "Jinja2==3.1.6" "MarkupSafe==3.0.2"; then
            echo "ERROR: Failed to install Jinja2/MarkupSafe into $ovms_lib_python." >&2
            exit 1
        fi
    fi
    echo "Preparing OVMS conversion environment..."
    startup_event '{"event":"stage","stage":"preparing","detail":"Installing the model conversion tools"}'
    if ! "$UV_CMD" sync --frozen --project "$WORKERS_ROOT/common/ovms-export"; then
        startup_event '{"event":"failure","summary":"Could not install the model conversion tools (uv sync failed)"}'
        return 1
    fi
    startup_event '{"event":"stage-end","stage":"preparing"}'
}

# run_worker [args...] -- cd into the worker directory and exec its entrypoint under uv. No --project:
# uv finds the workspace (or an excluded worker's own project) by walking up.
run_worker() {
    prepare_worker || return 1
    cd "$SCRIPT_DIR" || return
    exec "$UV_CMD" run --no-sync main.py "$@"
}

# run_oep_worker [args...] -- for a worker wrapping an OEP microservice (an "install" entry in
# oep-services.json): build .venv from upstream's own dependency file at the fetched tag
# (scripts/oep_env.py; only checks when nothing changed), then exec main.py in it.
run_oep_worker() {
    require_uv
    startup_event '{"event":"stage","stage":"preparing","detail":"Installing dependencies"}'
    if ! "$UV_CMD" run --no-config --no-project --python 3.12 "$WORKERS_ROOT/scripts/oep_env.py" \
        --uv "$UV_CMD" "${SCRIPT_DIR#"$WORKERS_ROOT"/}"; then
        startup_event '{"event":"failure","summary":"Could not install the worker dependencies (uv pip install failed)"}'
        return 1
    fi
    startup_event '{"event":"stage-end","stage":"preparing"}'
    cd "$SCRIPT_DIR" || return
    # As `uv run` would: upstream starts optimum-cli and the like from this environment by name.
    export VIRTUAL_ENV="$SCRIPT_DIR/.venv"
    export PATH="$VIRTUAL_ENV/bin:$PATH"
    exec "$VIRTUAL_ENV/bin/python" main.py "$@"
}
