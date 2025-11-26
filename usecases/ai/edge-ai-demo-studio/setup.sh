#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SkipFrontend="${SkipFrontend:-false}"
SkipElectron="${SkipElectron:-true}"
SkipWorkers="${SkipWorkers:-false}"
Verbose="${Verbose:-false}"
ContinueOnError="${ContinueOnError:-false}"
SUCCESSFUL_SETUPS=()
FAILED_SETUPS=()
SKIPPED_SETUPS=()

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THIRDPARTY_DIR="$SCRIPT_DIR/thirdparty"
LOG_DIR="$SCRIPT_DIR/logs/setup"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

# Function to cleanup old logs
cleanup_old_logs() {
  if [ -d "$LOG_DIR" ]; then
    echo "Cleaning up old setup logs..."
    rm -f "$LOG_DIR"/*_*.log
    echo "Old logs removed."
  fi
}

# Function to setup logging
setup_logging() {
  if [ "$Verbose" != "true" ]; then
    mkdir -p "$LOG_DIR"
    cleanup_old_logs
    echo "Detailed logs will be written to service-specific files in: $LOG_DIR"
  fi
}

# Function to get service-specific log file
get_service_log() {
  local service_name="$1"
  echo "$LOG_DIR/${service_name}_${TIMESTAMP}.log"
}

setup_services() {
  services=(
    "Name=Workers;Path=workers;Skip=${SkipWorkers}"
    "Name=Frontend;Path=frontend;Skip=${SkipFrontend}"
    "Name=Electron;Path=electron;Skip=${SkipElectron}"
  )


  for svc in "${services[@]}"; do
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
      args=()
      if [ "$Name" = "Workers" ] && [ "$SkipWorkers" = "false" ]; then
        args+=("--setup-workers")
      fi
      if [ "$Verbose" = "true" ]; then
        args+=("--verbose")
      fi
      if [ "$ContinueOnError" = "true" ]; then
        args+=("--continue-on-error")
      fi

      # Create service-specific log file
      local service_log_file
      service_log_file="$(get_service_log "$Name")"
      
      if [ "$Verbose" = "true" ]; then
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
        echo "=== $Name Setup Log - $(date) ===" > "$service_log_file"
        echo "" >> "$service_log_file"

        echo "Output is being logged to: $service_log_file"
        
        if bash "$SERVICE_SETUP_PATH" "${args[@]}" >> "$service_log_file" 2>&1; then
          echo "✅ $Name setup completed successfully!"
          echo "$Name setup completed successfully at $(date)" >> "$service_log_file"
          SUCCESSFUL_SETUPS+=("$Name")
        else
          exit_code=$?
          echo "❌ $Name setup failed with exit code $exit_code"
          echo "$Name setup failed with exit code $exit_code at $(date)" >> "$service_log_file"
          FAILED_SETUPS+=("$Name: failed with exit code $exit_code")
          echo "📋 Check log file: $service_log_file"
          if [ "$ContinueOnError" != "true" ]; then
            echo "Setup failed for $Name. Use --continue-on-error to continue with remaining services."
            exit 1
          else
            echo "Setup failed for $Name, but continuing with remaining services..."
          fi
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

  if [ ${#FAILED_SETUPS[@]} -eq 0 ]; then
    echo "All service setup processes completed successfully!"
    exit 0
  else
    echo "Some service setups failed. Check the summary above for details."
    if [ "$Verbose" != "true" ]; then
      echo "Check individual service logs in $LOG_DIR for detailed error information."
    fi
    exit 1
  fi
}

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
    --enable-electron)
      SkipElectron="false"
      shift
      ;;
    --continue-on-error)
      ContinueOnError="true"
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--verbose|-v] [--skip-workers] [--skip-frontend] [--skip-electron] [--enable-electron] [--continue-on-error]"
      exit 1
      ;;
  esac
done

if [ "${Verbose:-false}" = "true" ]; then
  set -x
fi

main() {
  cd "$SCRIPT_DIR"
  
  # Setup logging
  setup_logging
  
  echo "=== Setting up thirdparty dependencies ==="
  if ! bash "$SCRIPT_DIR/scripts/bash/setup_thirdparty.sh" "$THIRDPARTY_DIR"; then
    echo "❌ ERROR: Thirdparty setup failed. Cannot continue with service setup."
    echo "Please resolve the thirdparty setup issues and try again."
    exit 1
  fi
  echo ""
  
  setup_services
}

main