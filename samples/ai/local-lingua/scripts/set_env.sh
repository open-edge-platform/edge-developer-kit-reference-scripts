#!/usr/bin/env bash
# Update or append KEY=VALUE in an env file without clobbering other entries.
# Shared by the Makefile and scripts/detect_metrics_manager.sh so that neither
# truncates variables written by the other.
#
# Usage: scripts/set_env.sh KEY VALUE [ENV_FILE]
set -euo pipefail

key="${1:?usage: set_env.sh KEY VALUE [ENV_FILE]}"
value="${2-}"
env_file="${3:-${ENV_FILE:-.env}}"

touch "$env_file"
if grep -q "^${key}=" "$env_file" 2>/dev/null; then
  sed -i "s|^${key}=.*|${key}=${value}|" "$env_file"
else
  echo "${key}=${value}" >> "$env_file"
fi
