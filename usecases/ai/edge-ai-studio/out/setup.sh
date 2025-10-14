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


# Resources directory in the packaged application
RESOURCES_DIR="$SCRIPT_DIR/linux-unpacked/resources"
THIRDPARTY_DIR="$RESOURCES_DIR/thirdparty"

# List of services to set up (Name, Path, Skip flag)
declare -A service_configs
service_configs[Workers]="workers:$SkipWorkers"
# Frontend setup is skipped - only setting up workers


# Set up each service by running its setup.sh unless skipped
setup_services() {
  for Name in "${!service_configs[@]}"; do
    # Parse the path and skip flag
    local config_value="${service_configs[$Name]}"
    local Path="${config_value%:*}"
    local Skip="${config_value#*:}"
    if [ "$Skip" = "true" ]; then
      echo "Skipping setup for $Name"
      continue
    fi
    cd "$RESOURCES_DIR"
    SERVICE_SETUP_FILE="setup.sh"
    SERVICE_SETUP_PATH="$RESOURCES_DIR/$Path/$SERVICE_SETUP_FILE"
    if [ -d "$Path" ]; then
      cd "$Path"
      echo "Setting up $Name at $RESOURCES_DIR/$Path"
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
      cd "$RESOURCES_DIR"
    else
      echo "Directory not found: $RESOURCES_DIR/$Path"
      exit 1
    fi
  done
}


# Argument parsing
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
  # Check if resources directory exists
  if [ ! -d "$RESOURCES_DIR" ]; then
    echo "Error: Resources directory not found at $RESOURCES_DIR"
    echo "Make sure you're running this script from the correct location."
    exit 1
  fi
  
  cd "$RESOURCES_DIR"
  
  # Run third-party setup script if it exists
  if [ -f "$RESOURCES_DIR/scripts/setup_thirdparty.sh" ]; then
    echo "Running third-party setup script..."
    bash "$RESOURCES_DIR/scripts/setup_thirdparty.sh" "$THIRDPARTY_DIR"
  else
    echo "Warning: Third-party setup script not found at $RESOURCES_DIR/scripts/setup_thirdparty.sh"
  fi
  
  setup_services
  
  echo "Setup completed successfully!"
}

main