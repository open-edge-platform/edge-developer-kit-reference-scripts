#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Exit on error, unset variable, or failed pipe
set -euo pipefail


# Set default skip variables if not already set
SkipFrontend="${SkipFrontend:-false}"
SkipElectron="${SkipElectron:-false}"
SkipWorkers="${SkipWorkers:-false}"


# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"


# Node.js installation variables
THIRDPARTY_DIR="$SCRIPT_DIR/thirdparty"

# List of services to set up (Name, Path, Skip flag)
services=(
  "Name=Workers;Path=workers;Skip=${SkipWorkers}"
  "Name=Frontend;Path=frontend;Skip=${SkipFrontend}"
  "Name=Electron;Path=electron;Skip=${SkipElectron}"
)


# Set up each service by running its setup.sh unless skipped
setup_services() {
  for svc in "${services[@]}"; do
    # Parse key=value;key=value strings without eval for safety
    Name=""
    Path=""
    Skip="false"
    IFS=';'
    for pair in $svc; do
      key=${pair%%=*}
      val=${pair#*=}
      case "$key" in
        Name) Name="$val" ;;
        Path) Path="$val" ;;
        Skip) Skip="$val" ;;
      esac
    done
    unset IFS

    if [ "$Skip" = "true" ]; then
      echo "Skipping setup for $Name"
      continue
    fi

    SERVICE_SETUP_FILE="setup.sh"
    SERVICE_SETUP_PATH="$SCRIPT_DIR/$Path/$SERVICE_SETUP_FILE"
    echo "Setting up $Name at $Path"
    if [ -f "$SERVICE_SETUP_PATH" ]; then
      if [ "$Name" = "Workers" ] && [ "$SkipWorkers" = "false" ]; then
        bash "$SERVICE_SETUP_PATH" --setup-workers
      else
        bash "$SERVICE_SETUP_PATH"
      fi
    else
      echo "Setup script not found for $Name at $SERVICE_SETUP_PATH"
      exit 1
    fi
  done
}


# Argument parsing for --setup-all-workers
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-workers)
      SkipWorkers="true"
      shift
      ;;
    --skip-frontend)
      SkipFrontend="true"
      shift
      ;;
    --skip-electron)
      SkipElectron="true"
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Main entry point
main() {
  cd "$SCRIPT_DIR"
  bash "$SCRIPT_DIR/scripts/setup_thirdparty.sh" "$THIRDPARTY_DIR"
  setup_services
}

main
