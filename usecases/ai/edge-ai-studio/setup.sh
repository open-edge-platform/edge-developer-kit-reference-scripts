#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Exit on error, unset variable, or failed pipe
set -euo pipefail


# Set default skip variables if not already set
SkipFrontend="${SkipFrontend:-false}"
SkipElectron="${SkipElectron:-false}"
SkipWorkers="${SkipWorkers:-false}"
# Verbose flag (can also be enabled with --verbose or -v)
Verbose="${Verbose:-false}"
# Continue on error flag
ContinueOnError="${ContinueOnError:-false}"
# Track setup results
SUCCESSFUL_SETUPS=()
FAILED_SETUPS=()
SKIPPED_SETUPS=()


# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"


# Node.js installation variables
THIRDPARTY_DIR="$SCRIPT_DIR/thirdparty"

# Set up each service by running its setup.sh unless skipped
setup_services() {
  # List of services to set up (Name, Path, Skip flag)
  services=(
    "Name=Workers;Path=workers;Skip=${SkipWorkers}"
    "Name=Frontend;Path=frontend;Skip=${SkipFrontend}"
    "Name=Electron;Path=electron;Skip=${SkipElectron}"
  )


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
      SKIPPED_SETUPS+=("$Name")
      continue
    fi
    
    SERVICE_SETUP_FILE="setup.sh"
    SERVICE_SETUP_PATH="$SCRIPT_DIR/$Path/$SERVICE_SETUP_FILE"
    echo "Setting up $Name at $Path"
    
    if [ -f "$SERVICE_SETUP_PATH" ]; then
      # Build argument list for the child setup script
      args=()
      if [ "$Name" = "Workers" ] && [ "$SkipWorkers" = "false" ]; then
        args+=("--setup-workers")
      fi
      if [ "$Verbose" = "true" ]; then
        args+=("--verbose")
      fi
      if [ "$ContinueOnError" = "true" ] && [ "$Name" = "Workers" ]; then
        args+=("--continue-on-error")
      fi

      # Invoke the child setup script with the assembled args
      if bash "$SERVICE_SETUP_PATH" "${args[@]}"; then
        echo "✅ $Name setup completed successfully!"
        SUCCESSFUL_SETUPS+=("$Name")
      else
        exit_code=$?
        echo "❌ $Name setup failed with exit code $exit_code"
        FAILED_SETUPS+=("$Name: failed with exit code $exit_code")
        if [ "$ContinueOnError" != "true" ]; then
          echo "Setup failed for $Name. Use --continue-on-error to continue with remaining services."
          exit 1
        else
          echo "Setup failed for $Name, but continuing with remaining services..."
        fi
      fi
    else
      echo "❌ Setup script not found for $Name at $SERVICE_SETUP_PATH"
      FAILED_SETUPS+=("$Name: setup script not found")
      if [ "$ContinueOnError" != "true" ]; then
        echo "Setup script not found for $Name. Use --continue-on-error to continue with remaining services."
        exit 1
      else
        echo "Setup script not found for $Name, but continuing with remaining services..."
      fi
    fi
  done
  
  # Display summary
  echo ""
  echo "=== Setup Summary ==="
  
  if [ ${#SUCCESSFUL_SETUPS[@]} -gt 0 ]; then
    echo "✅ Successful setups (${#SUCCESSFUL_SETUPS[@]}):"
    for success in "${SUCCESSFUL_SETUPS[@]}"; do
      echo "  - $success"
    done
  fi
  
  if [ ${#FAILED_SETUPS[@]} -gt 0 ]; then
    echo "❌ Failed setups (${#FAILED_SETUPS[@]}):"
    for failure in "${FAILED_SETUPS[@]}"; do
      echo "  - $failure"
    done
  fi
  
  if [ ${#SKIPPED_SETUPS[@]} -gt 0 ]; then
    echo "⏭️  Skipped setups (${#SKIPPED_SETUPS[@]}):"
    for skipped in "${SKIPPED_SETUPS[@]}"; do
      echo "  - $skipped"
    done
  fi
  
  echo "==================="
  
  # Final status
  if [ ${#FAILED_SETUPS[@]} -eq 0 ]; then
    echo "All service setup processes completed successfully!"
    exit 0
  else
    echo "Some service setups failed. Check the summary above for details."
    exit 1
  fi
}


# Argument parsing for --setup-all-workers
while [[ $# -gt 0 ]]; do
  case "$1" in
    --verbose|-v)
      Verbose="true"
      shift
      ;;
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
    --continue-on-error)
      ContinueOnError="true"
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--verbose|-v] [--skip-workers] [--skip-frontend] [--skip-electron] [--continue-on-error]"
      exit 1
      ;;
  esac
done

# If verbose enabled, turn on shell xtrace for detailed tracing
if [ "${Verbose:-false}" = "true" ]; then
  set -x
fi
# Main entry point
main() {
  cd "$SCRIPT_DIR"
  bash "$SCRIPT_DIR/scripts/setup_thirdparty.sh" "$THIRDPARTY_DIR"
  setup_services
}

main