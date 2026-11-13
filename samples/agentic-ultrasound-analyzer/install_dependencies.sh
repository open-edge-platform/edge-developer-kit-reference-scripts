#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
# Installs application dependencies using Python 3.12-3.14.
# Run with bash install_dependencies.sh. 

set -Eeuo pipefail

export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR_PATH="$SCRIPT_DIR/venv"
REQUIREMENTS_FILE_PATH="$SCRIPT_DIR/requirements.txt"
PYTHON="${PYTHON:-python3}"
INSTALL_LOG_PATH="$SCRIPT_DIR/scripts/logs/install_dependencies.log"

fail() {
    echo "[ERROR] $*" >&2
    if [[ -f "$INSTALL_LOG_PATH" ]]; then
        echo "Last lines of $INSTALL_LOG_PATH:" >&2
        tail -n 20 -- "$INSTALL_LOG_PATH" >&2
    fi
    exit 1
}

on_error() {
    local status="$1"
    local line="$2"
    echo "[ERROR] Setup failed at line $line (exit $status). See $INSTALL_LOG_PATH." >&2
    exit "$status"
}

trap 'on_error "$?" "$LINENO"' ERR

run_logged() {
    local description="$1"
    shift
    echo "$description (log: $INSTALL_LOG_PATH)"
    "$@" >> "$INSTALL_LOG_PATH" 2>&1 || fail "$description failed."
}

check_python_version() {
    "$1" -c 'import sys; supported = sys.version_info[:2] in ((3, 12), (3, 13), (3, 14)); sys.exit(1) if not supported else print("Python " + ".".join(map(str, sys.version_info[:3])))' ||
        fail "Python 3.12, 3.13 or 3.14 is required. Interpreter: $1"
}

[[ "$(uname -s)" == "Linux" ]] || fail "This installer supports Linux only."
command -v "$PYTHON" > /dev/null || fail "Python is not installed or not on PATH: $PYTHON"
command -v git > /dev/null || fail "Git is required to install the pinned optimum-intel dependency."
cd -- "$SCRIPT_DIR"
mkdir -p -- "$SCRIPT_DIR/scripts/logs"
touch -- "$INSTALL_LOG_PATH"
if [[ -r /proc/cpuinfo ]]; then
    awk -F ': ' '/model name/ {print "CPU: " $2; exit}' /proc/cpuinfo
fi
check_python_version "$PYTHON"

if [[ -e "$VENV_DIR_PATH" ]]; then
    [[ -x "$VENV_DIR_PATH/bin/python" ]] ||
        fail "The existing virtual environment has no Linux Python interpreter. Use a separate Linux checkout or move the incompatible environment."
    check_python_version "$VENV_DIR_PATH/bin/python"
    echo "Python virtual environment already exists."
else
    run_logged "Creating Python virtual environment" "$PYTHON" -m venv "$VENV_DIR_PATH"
fi
VENV_PYTHON="$VENV_DIR_PATH/bin/python"

run_logged "Upgrading pip" "$VENV_PYTHON" -m pip install --upgrade pip
run_logged "Installing application dependencies" "$VENV_PYTHON" -m pip install -r "$REQUIREMENTS_FILE_PATH"
echo "Installation completed!"