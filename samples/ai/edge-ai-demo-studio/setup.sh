#!/bin/bash
# Copyright (C) 2026 Intel Corporation
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

BackendChoice="${BackendChoice:-}"
# Worker-level flags (--skip-stt, ...) forwarded verbatim to workers/setup.sh.
WorkerArgs=()

# CI systems often export 1/0 or yes/no rather than true/false.
normalize_bool() {
  case "${1,,}" in
    true|1|yes|y|on) echo "true" ;;
    *) echo "false" ;;
  esac
}

print_usage() {
  cat <<EOF
Usage: $0 [options]

Installs the thirdparty tools (Node.js, FFmpeg, qmassa), selects the llama.cpp backend
for the multiserve engine, then runs the Workers, Frontend and Electron setups.

Options:
  --backend sycl|vulkan   llama.cpp backend for the multiserve engine (skips the
                          prompt). 'sycl' installs its runtime from Python wheels
                          into workers/.venv; no Intel oneAPI Toolkit is needed.
  --sycl, --vulkan        Shorthands for --backend sycl / --backend vulkan.
  --skip-workers          Skip the Workers setup.
  --skip-frontend         Skip the Frontend setup.
  --skip-electron         Skip the Electron setup (this is the default).
  --enable-electron       Run the Electron setup.
  --skip-stt, --skip-embedding, --skip-llm, --skip-tts
                          Legacy flags. Worker dependencies are installed
                          when each service starts.
  --continue-on-error     Keep going when a service setup fails. The exit code
                          is still non-zero when anything failed.
  -v, --verbose           Print all output to the terminal instead of logs/setup/.
  -h, --help              Show this help and exit.

Environment variables (same effect as the flags; accept true/false, 1/0, yes/no):
  SkipWorkers SkipFrontend SkipElectron Verbose ContinueOnError BackendChoice

Without a TTY and without --backend, the selection already saved in
workers/engines/multiserve/.llamacpp-backend is kept, or vulkan is used when
there is none.
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THIRDPARTY_DIR="$SCRIPT_DIR/thirdparty"
LOG_DIR="$SCRIPT_DIR/logs/setup"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
# workers/setup.sh reuses it, which tells it not to clean up this run's logs.
export EADS_SETUP_TIMESTAMP="$TIMESTAMP"

# Shared llama.cpp backend helpers: scripts/bash/ in the repo, scripts/ in a packaged build.
for backend_helper in \
  "$SCRIPT_DIR/scripts/bash/llamacpp_backend.sh" \
  "$SCRIPT_DIR/scripts/llamacpp_backend.sh" \
  "$SCRIPT_DIR/llamacpp_backend.sh"; do
  if [ -f "$backend_helper" ]; then
    # shellcheck source=scripts/bash/llamacpp_backend.sh disable=SC1091
    source "$backend_helper"
    break
  fi
done

cleanup_old_logs() {
  if [ -n "$LOG_DIR" ] && [ -d "$LOG_DIR" ]; then
    echo "Cleaning up old setup logs..."
    find "$LOG_DIR" -maxdepth 1 -type f -name '*_*.log' -delete
    echo "Old logs removed."
  fi
}

setup_logging() {
  if [ "$Verbose" != "true" ]; then
    mkdir -p "$LOG_DIR"
    cleanup_old_logs
    echo "Detailed logs will be written to service-specific files in: $LOG_DIR"
  fi
}

get_service_log() {
  local service_name="$1"
  echo "$LOG_DIR/${service_name}_${TIMESTAMP}.log"
}

# Ask for the multiserve llama.cpp backend (previous choice as default) and save it to
# .llamacpp-backend, read by multiserve/setup.sh and start.sh. Re-running switches backends.
select_llamacpp_backend() {
  echo "=== Selecting llama.cpp backend for the multiserve engine ==="

  if ! command -v lb_load_config >/dev/null 2>&1; then
    echo "⚠️  Backend helper not found - defaulting to the Vulkan backend."
    export LLAMACPP_BACKEND="vulkan"
    echo ""
    return 0
  fi

  # Only the multiserve engine runs llama.cpp.
  if ! lb_multiserve_present; then
    echo "Multiserve engine not present in this build - nothing to configure."
    echo ""
    return 0
  fi

  local previous=""
  if lb_load_config; then
    previous="$LLAMACPP_BACKEND"
    echo "Current selection: $previous"
  fi

  local choice="$BackendChoice"

  if [ -z "$choice" ]; then
    local default_choice="${previous:-vulkan}"

    if [ -t 0 ]; then
      echo ""
      echo "  1) sycl   - SYCL build for Intel GPUs (its runtime adds ~0.3 GB to workers/.venv)"
      echo "  2) vulkan - Vulkan build (any Vulkan GPU, nothing extra)"
      echo ""
      local reply=""
      read -r -p "Which backend should llama.cpp use? [$default_choice]: " reply
      case "${reply,,}" in
        1|sycl) choice="sycl" ;;
        2|vulkan) choice="vulkan" ;;
        "") choice="$default_choice" ;;
        *)
          echo "Unrecognised answer '$reply' - using $default_choice."
          choice="$default_choice"
          ;;
      esac
    else
      choice="$default_choice"
      echo "Non-interactive shell - using '$choice'. Override with --backend sycl|vulkan."
    fi
  else
    echo "Backend forced to '$choice' via --backend."
  fi

  # The multiserve setup installs the SYCL runtime, matched to the build it downloads.
  local precision="fp16"
  if [ "$choice" = "sycl" ]; then
    precision="$(lb_detect_sycl_precision)"
    echo "  → SYCL precision: $precision"
  fi

  lb_save_config "$choice" "$precision"

  if [ -n "$previous" ] && [ "$previous" != "$choice" ]; then
    echo "Backend changed: $previous → $choice (the unused llama.cpp build will be removed)"
  fi

  if [ "$choice" = "sycl" ]; then
    echo "✅ llama.cpp backend: $choice ($precision)"
  else
    echo "✅ llama.cpp backend: $choice"
  fi
  echo "   Saved to $LLAMACPP_BACKEND_CONFIG_FILE"
  echo ""
}

# Unlike the services, its output also stays on the terminal: it is short and carries the warnings.
setup_thirdparty() {
  local setup_script="$SCRIPT_DIR/scripts/bash/setup_thirdparty.sh"
  if [ "$Verbose" = "true" ]; then
    bash "$setup_script" "$THIRDPARTY_DIR"
    return
  fi

  local log_file exit_code=0
  log_file="$(get_service_log "Thirdparty")"
  echo "=== Thirdparty Setup Log - $(date) ===" > "$log_file"
  echo "" >> "$log_file"
  echo "Output is being logged to: $log_file"

  bash "$setup_script" "$THIRDPARTY_DIR" 2>&1 | tee -a "$log_file" || exit_code=$?
  if [ "$exit_code" -eq 0 ]; then
    echo "Thirdparty setup completed successfully at $(date)" >> "$log_file"
  else
    echo "Thirdparty setup failed with exit code $exit_code at $(date)" >> "$log_file"
    echo "📋 Check log file: $log_file"
  fi
  return "$exit_code"
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
    local oldIFS="$IFS"
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
    IFS="$oldIFS"

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
        args+=("${WorkerArgs[@]+"${WorkerArgs[@]}"}")
      fi
      if [ "$Verbose" = "true" ]; then
        args+=("--verbose")
      fi
      if [ "$ContinueOnError" = "true" ]; then
        args+=("--continue-on-error")
      fi

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
          echo ""
          echo "--- Last output from $Name setup ---"
          tail -30 "$service_log_file"
          echo "------------------------------------"
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
    --backend)
      if [ $# -lt 2 ]; then
        echo "Error: --backend requires an argument (sycl or vulkan)" >&2
        exit 1
      fi
      BackendChoice="$2"
      shift 2
      ;;
    --backend=*)
      BackendChoice="${1#*=}"
      shift
      ;;
    --sycl)
      BackendChoice="sycl"
      shift
      ;;
    --vulkan)
      BackendChoice="vulkan"
      shift
      ;;
    --skip-stt|--skip-embedding|--skip-llm|--skip-tts)
      WorkerArgs+=("$1")
      shift
      ;;
    --help|-h)
      print_usage
      exit 0
      ;;
    *)
      echo "Error: unknown option '$1'" >&2
      echo "Run '$0 --help' for the list of options." >&2
      exit 1
      ;;
  esac
done

SkipFrontend="$(normalize_bool "$SkipFrontend")"
SkipElectron="$(normalize_bool "$SkipElectron")"
SkipWorkers="$(normalize_bool "$SkipWorkers")"
Verbose="$(normalize_bool "$Verbose")"
ContinueOnError="$(normalize_bool "$ContinueOnError")"
BackendChoice="${BackendChoice,,}"

case "${BackendChoice:-}" in
  ""|sycl|vulkan) ;;
  *)
    echo "Error: --backend must be 'sycl' or 'vulkan' (got '$BackendChoice')" >&2
    exit 1
    ;;
esac

if [ "${Verbose:-false}" = "true" ]; then
  # set -x echoes commands to stderr: never pass secrets as arguments.
  set -x
fi

main() {
  cd "$SCRIPT_DIR"
  
  setup_logging
  
  select_llamacpp_backend
  
  echo "=== Setting up thirdparty dependencies ==="
  if ! setup_thirdparty; then
    echo "❌ ERROR: Thirdparty setup failed. Cannot continue with service setup."
    echo "Please resolve the thirdparty setup issues and try again."
    exit 1
  fi
  echo ""
  
  setup_services
}

main
