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
# As given, for the setup log; parsing shifts them away.
SETUP_ARGS=("$@")

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
# Setup_<timestamp>.log: what this script prints, under a header describing the run. Not with --verbose.
MAIN_LOG=""
TEE_PID=""

# Shared llama.cpp backend helpers: scripts/bash/ in the repo, scripts/ in a packaged build.
for backend_helper in \
  "$SCRIPT_DIR/scripts/bash/llamacpp_backend.sh" \
  "$SCRIPT_DIR/scripts/llamacpp_backend.sh" \
  "$SCRIPT_DIR/llamacpp_backend.sh"; do
  if [ -f "$backend_helper" ]; then
    # shellcheck source=SCRIPTDIR/scripts/bash/llamacpp_backend.sh
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

# format_duration <seconds> -- e.g. 45s, 3m 07s, 1h 02m 05s
format_duration() {
  local s="$1"
  if [ "$s" -ge 3600 ]; then
    printf '%dh %02dm %02ds\n' $((s / 3600)) $((s % 3600 / 60)) $((s % 60))
  elif [ "$s" -ge 60 ]; then
    printf '%dm %02ds\n' $((s / 60)) $((s % 60))
  else
    printf '%ds\n' "$s"
  fi
}

# What a log read on another machine needs: how setup was run, from which checkout, and on what
# hardware. Proxy credentials are masked.
print_run_info() {
  echo "Command:   $0${SETUP_ARGS[*]+ ${SETUP_ARGS[*]}}"
  echo "Options:   SkipWorkers=$SkipWorkers SkipFrontend=$SkipFrontend SkipElectron=$SkipElectron ContinueOnError=$ContinueOnError BackendChoice=${BackendChoice:-<saved or prompt>}"

  local commit branch
  if [ -e "$SCRIPT_DIR/.git" ] && commit="$(git -C "$SCRIPT_DIR" rev-parse --short HEAD 2>/dev/null)"; then
    branch="$(git -C "$SCRIPT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")"
    if [ -n "$(git -C "$SCRIPT_DIR" status --porcelain --untracked-files=no 2>/dev/null)" ]; then
      echo "Checkout:  $branch @ $commit (uncommitted changes)"
    else
      echo "Checkout:  $branch @ $commit"
    fi
  else
    echo "Checkout:  not a git checkout"
  fi

  local os="unknown"
  if [ -r /etc/os-release ]; then
    os="$(sed -n 's/^PRETTY_NAME=//p' /etc/os-release | tr -d '"')"
  fi
  echo "System:    ${os:-unknown}, kernel $(uname -r), $(uname -m)"
  echo "CPU:       $(sed -n '/^model name/{s/^model name[[:space:]]*: //p;q}' /proc/cpuinfo 2>/dev/null) ($(nproc) threads)"
  echo "Memory:    $(awk '/^MemTotal:/ { printf "%.1f GiB", $2 / 1048576 }' /proc/meminfo 2>/dev/null)"
  echo "Free disk: $(df -h --output=avail "$SCRIPT_DIR" 2>/dev/null | tail -n 1 | tr -d ' ') on the project's filesystem"

  # The pci.ids setup downloads names recent GPUs the system's copy lists as bare device IDs.
  local gpus="" pci_ids=()
  if [ -f "$THIRDPARTY_DIR/pci.ids" ]; then
    pci_ids=(-i "$THIRDPARTY_DIR/pci.ids")
  fi
  if command -v lspci >/dev/null 2>&1; then
    gpus="$(lspci ${pci_ids[@]+"${pci_ids[@]}"} 2>/dev/null |
      grep -E 'VGA compatible controller|3D controller|Display controller|Processing accelerators' || true)"
  fi
  if [ -n "$gpus" ]; then
    printf '%s\n' "$gpus" | sed 's/^/GPU\/NPU:   /'
  else
    echo "GPU/NPU:   none listed by lspci"
  fi
  # The GPU and NPU nodes the workers open; without access they fall back to the CPU.
  local node devices=""
  for node in /dev/dri/renderD* /dev/accel/accel*; do
    [ -e "$node" ] || continue
    if [ -r "$node" ] && [ -w "$node" ]; then
      devices+=" $node"
    else
      devices+=" $node (no access for this user)"
    fi
  done
  echo "Dev nodes:${devices:- none}"

  local var proxies=""
  for var in http_proxy https_proxy no_proxy HTTP_PROXY HTTPS_PROXY NO_PROXY; do
    if [ -n "${!var:-}" ]; then
      proxies+=" $var=$(printf '%s' "${!var}" | sed -E 's#//[^/@]*@#//***@#')"
    fi
  done
  echo "Proxy:    ${proxies:- none}"
}

# The EXIT trap while the setup log is open: record how the run ended, then wait for tee so the
# last lines are written before the shell prompt returns.
finish_logging() {
  local status=$?
  echo ""
  case "$status" in
    0) echo "=== Setup finished at $(date) after $(format_duration "$SECONDS") ===" ;;
    130|143) echo "=== Setup interrupted at $(date) after $(format_duration "$SECONDS") ===" ;;
    *) echo "=== Setup failed with exit code $status at $(date) after $(format_duration "$SECONDS") ===" ;;
  esac
  exec >&- 2>&-
  wait "$TEE_PID" 2>/dev/null || true
}

setup_logging() {
  if [ "$Verbose" != "true" ]; then
    mkdir -p "$LOG_DIR"
    cleanup_old_logs
    MAIN_LOG="$(get_service_log "Setup")"
    {
      echo "=== Setup Log - $(date) ==="
      print_run_info
      echo ""
    } > "$MAIN_LOG"
    # From here on everything goes to the terminal and the setup log. tee ignores Ctrl+C, so an
    # interrupted run still records how it ended; the explicit exits give the EXIT trap its status.
    exec > >(trap '' INT TERM; exec tee -a "$MAIN_LOG") 2>&1
    TEE_PID=$!
    trap finish_logging EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    echo "Setup log: $MAIN_LOG"
    echo "Detailed logs will be written to service-specific files in: $LOG_DIR"
  else
    # --verbose traces commands, which would print the proxy settings before they are masked.
    { set +x; } 2>/dev/null
    print_run_info
    set -x
  fi
  echo ""
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
      # The terminal echoes the answer as it is typed; the setup log gets it here.
      if [ -n "$MAIN_LOG" ]; then
        echo "$reply" >> "$MAIN_LOG"
      fi
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
  local started=$SECONDS exit_code=0
  if [ "$Verbose" = "true" ]; then
    bash "$setup_script" "$THIRDPARTY_DIR" || exit_code=$?
    if [ "$exit_code" -eq 0 ]; then
      SUCCESSFUL_SETUPS+=("Thirdparty ($(format_duration $((SECONDS - started))))")
    fi
    return "$exit_code"
  fi

  local log_file
  log_file="$(get_service_log "Thirdparty")"
  echo "=== Thirdparty Setup Log - $(date) ===" > "$log_file"
  echo "Command: bash $setup_script $THIRDPARTY_DIR" >> "$log_file"
  echo "" >> "$log_file"
  echo "Output is being logged to: $log_file"

  bash "$setup_script" "$THIRDPARTY_DIR" 2>&1 | tee -a "$log_file" || exit_code=$?
  local elapsed
  elapsed="$(format_duration $((SECONDS - started)))"
  if [ "$exit_code" -eq 0 ]; then
    echo "Thirdparty setup completed successfully at $(date) ($elapsed)" >> "$log_file"
    SUCCESSFUL_SETUPS+=("Thirdparty ($elapsed)")
  else
    echo "Thirdparty setup failed with exit code $exit_code at $(date) after $elapsed" >> "$log_file"
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

      local service_log_file started elapsed
      service_log_file="$(get_service_log "$Name")"
      started=$SECONDS

      if [ "$Verbose" = "true" ]; then
        if bash "$SERVICE_SETUP_PATH" "${args[@]}"; then
          elapsed="$(format_duration $((SECONDS - started)))"
          echo "✅ $Name setup completed successfully ($elapsed)"
          SUCCESSFUL_SETUPS+=("$Name ($elapsed)")
        else
          exit_code=$?
          elapsed="$(format_duration $((SECONDS - started)))"
          echo "❌ $Name setup failed with exit code $exit_code after $elapsed"
          FAILED_SETUPS+=("$Name: failed with exit code $exit_code after $elapsed")
          if [ "$ContinueOnError" != "true" ]; then
            echo "Setup failed for $Name. Use --continue-on-error to continue with remaining services."
            exit 1
          else
            echo "Setup failed for $Name, but continuing with remaining services..."
          fi
        fi
      else
        echo "=== $Name Setup Log - $(date) ===" > "$service_log_file"
        echo "Command: bash $SERVICE_SETUP_PATH${args[*]+ ${args[*]}}" >> "$service_log_file"
        echo "" >> "$service_log_file"

        echo "Output is being logged to: $service_log_file"

        if bash "$SERVICE_SETUP_PATH" "${args[@]}" >> "$service_log_file" 2>&1; then
          elapsed="$(format_duration $((SECONDS - started)))"
          echo "✅ $Name setup completed successfully ($elapsed)"
          echo "$Name setup completed successfully at $(date) ($elapsed)" >> "$service_log_file"
          SUCCESSFUL_SETUPS+=("$Name ($elapsed)")
        else
          exit_code=$?
          elapsed="$(format_duration $((SECONDS - started)))"
          echo "❌ $Name setup failed with exit code $exit_code after $elapsed"
          echo "$Name setup failed with exit code $exit_code at $(date) after $elapsed" >> "$service_log_file"
          FAILED_SETUPS+=("$Name: failed with exit code $exit_code after $elapsed, see $service_log_file")
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
  
  echo "Total time: $(format_duration "$SECONDS")"
  if [ -n "$MAIN_LOG" ]; then
    echo "Logs of this run (attach them when reporting a setup problem):"
    local log
    for log in "$LOG_DIR"/*_"$TIMESTAMP".log; do
      if [ -f "$log" ]; then
        echo "  - $log"
      fi
    done
  fi
  echo "==================="

  if [ ${#FAILED_SETUPS[@]} -eq 0 ]; then
    echo "All service setup processes completed successfully!"
    return 0
  else
    echo "Some service setups failed. Check the summary above for details."
    if [ "$Verbose" != "true" ]; then
      echo "Check individual service logs in $LOG_DIR for detailed error information."
    fi
    return 1
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
