#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
# coverity_scan.sh - Run Coverity scan locally
#
# This script runs Coverity analysis on the project code locally.
# It will download and set up Coverity if needed, configure it for the
# specified languages, and run the analysis without committing results.
#
# Usage:
#   ./coverity_scan.sh [OPTIONS]
#
# Options:
#   --package-dir=DIR      Path to the package directory to scan
#   --languages=LIST       Comma-separated list of languages to analyze (default: python,javascript)
#   --thirdparty-dir=DIR   Path to store Coverity installation (default: ./thirdparty)
#   --log-file=FILE        Path to log file (default: ./logs/coverity.log)
#   --report-dir=DIR       Path to store reports (default: ./reports/coverity)
#
# Example:
#   ./coverity_scan.sh --package-dir=/path/to/source --languages=python,javascript

# Initialize variables with defaults
PACKAGE_DIR=""
LANGUAGES="python,javascript"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THIRDPARTY_DIR="${SCRIPT_DIR}/thirdparty"
LOGS_DIR="${SCRIPT_DIR}/logs"
REPORTS_DIR="${SCRIPT_DIR}/reports"
LOG_FILE="${LOGS_DIR}/coverity.log"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
REPORT_DIR="${REPORTS_DIR}/coverity_${TIMESTAMP}"
COV_VERSION="2025.3.0"
COV_INSTALLER_URL="https://af-amr01.devtools.intel.com/artifactory/coverity-or-local/Enterprise/cov-analysis-linux64-2025.3.0.sh"
COV_LICENSE_URL="https://af-amr01.devtools.intel.com/artifactory/coverity-or-local/Enterprise/license.dat"

# Enhanced logging function with command logging support
log() {
  local message="$1"
  local timestamp
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  
  # Check if this script is being run from a parent script
  # PARENT_SCRIPT will be set by parent script when it calls this script
  if [ -z "${PARENT_SCRIPT:-}" ]; then
    # Direct execution - show output and log to file
    echo "[$timestamp] $message" | tee -a "$LOG_FILE"
  else
    # Running from a parent script - only log to file, don't echo
    # This prevents duplicate timestamps when run from run_tests.sh
    echo "[$timestamp] $message" >> "$LOG_FILE"
  fi
}

# Function to log commands before execution
log_cmd() {
  local cmd_desc="$1"
  local cmd="$2"
  
  log "$cmd_desc"
  log "EXECUTING: $cmd"
  
  # Also log to the log file for reference
  echo "COMMAND: $cmd" >> "$LOG_FILE"
}

# Process command-line arguments
for arg in "$@"; do
  case $arg in
    --package-dir=*)
      PACKAGE_DIR="${arg#*=}"
      ;;
    --languages=*)
      LANGUAGES="${arg#*=}"
      ;;
    --log-file=*)
      # Allow override but use the default structured location
      CUSTOM_LOG_FILE="${arg#*=}"
      if [ -n "$CUSTOM_LOG_FILE" ] && [ "$CUSTOM_LOG_FILE" != "/dev/null" ]; then
        LOG_FILE="$CUSTOM_LOG_FILE"
        log "Using custom log file: $LOG_FILE"
      fi
      ;;
    --thirdparty-dir=*)
      # Allow override but use the default structured location
      CUSTOM_THIRDPARTY_DIR="${arg#*=}"
      if [ -n "$CUSTOM_THIRDPARTY_DIR" ]; then
        THIRDPARTY_DIR="$CUSTOM_THIRDPARTY_DIR"
        log "Using custom third-party directory: $THIRDPARTY_DIR"
      fi
      ;;
    --report-dir=*)
      # Allow override but use the default structured location
      CUSTOM_REPORT_DIR="${arg#*=}"
      if [ -n "$CUSTOM_REPORT_DIR" ]; then
        REPORT_DIR="$CUSTOM_REPORT_DIR"
        log "Using custom report directory: $REPORT_DIR"
      fi
      ;;
    *)
      echo "Unknown option: $arg"
      exit 1
      ;;
  esac
done

# Ensure required parameters are provided
if [ -z "$PACKAGE_DIR" ]; then
  echo "Error: Package directory (--package-dir) is required"
  exit 1
fi

# Create all required directories
mkdir -p "${THIRDPARTY_DIR}" "${LOGS_DIR}" "${REPORT_DIR}"

# Convert languages string to array
IFS=',' read -ra LANG_ARRAY <<< "$LANGUAGES"

# Ensure log file directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# Ensure log file exists
if [ ! -f "$LOG_FILE" ]; then
  touch "$LOG_FILE"
fi

log "Starting Coverity scan"
log "Package directory: $PACKAGE_DIR"
log "Languages: $LANGUAGES"
log "Third-party directory: $THIRDPARTY_DIR"
log "Report directory: $REPORT_DIR"

# Set up paths
COV_INSTALL_DIR="${THIRDPARTY_DIR}/coverity/${COV_VERSION}/x64"
COV_BIN_DIR="${COV_INSTALL_DIR}/bin"
COV_CONFIG_FILE="${REPORT_DIR}/cov_config.xml"
COV_CAPTURE_DIR="${REPORT_DIR}/coverity_capture"
COV_LICENSE_FILE="${THIRDPARTY_DIR}/coverity/license.dat"
COV_BIN_LICENSE_FILE="${COV_BIN_DIR}/license.dat"  # License file in the bin directory

# Function to verify and fix license file permissions
verify_and_fix_license_permissions() {
  local license_file="$1"
  log "Verifying permissions for license file: $license_file"
  
  if [ ! -f "$license_file" ]; then
    log "ERROR: License file does not exist: $license_file"
    return 1
  fi
  
  # Check current permissions
  local current_permissions
  current_permissions=$(stat -c "%a" "$license_file")
  log "Current permissions: $current_permissions"
  
  # Check if file is readable by current user
  if [ ! -r "$license_file" ]; then
    log "WARNING: License file is not readable by current user"
    chmod 644 "$license_file"
    log "Fixed permissions to 644 (readable by all, writable by owner)"
  else
    # Set standard permissions anyway for consistency
    chmod 644 "$license_file"
    log "Set standard permissions (644) on license file"
  fi
  
  # Verify permissions were correctly set
  local new_permissions
  new_permissions=$(stat -c "%a" "$license_file")
  log "New permissions: $new_permissions"
  
  # Verify current user can read the file
  if [ -r "$license_file" ]; then
    log "License file is readable by current user"
    return 0
  else
    log "ERROR: License file is still not readable by current user after permission change"
    return 1
  fi
}

# Function to verify license file content and format
verify_license_file() {
  local license_file="$1"
  log "Performing detailed verification of license file: $license_file"
  
  if [ ! -f "$license_file" ]; then
    log "ERROR: License file does not exist: $license_file"
    return 1
  fi
  
  if [ ! -s "$license_file" ]; then
    log "ERROR: License file is empty: $license_file"
    return 1
  fi
  
  # Check license file permissions
  if [ ! -r "$license_file" ]; then
    log "ERROR: License file is not readable: $license_file"
    return 1
  fi
  
  log "License file verification completed"
  return 0
}

# Function to verify Coverity installation
verify_coverity_installation() {
  log "Verifying Coverity installation..."
  local required_binaries=("cov-configure" "cov-build" "cov-analyze" "cov-format-errors")
  local missing_binaries=()
  
  for bin in "${required_binaries[@]}"; do
    if [ ! -f "${COV_BIN_DIR}/${bin}" ] || [ ! -x "${COV_BIN_DIR}/${bin}" ]; then
      missing_binaries+=("${bin}")
    fi
  done
  
  if [ ${#missing_binaries[@]} -gt 0 ]; then
    log "ERROR: The following Coverity binaries are missing or not executable:"
    for bin in "${missing_binaries[@]}"; do
      log "  - ${bin}"
    done
    return 1
  fi
  
  log "Coverity installation verified successfully."
  return 0
}

# Check if Coverity is already installed
if [ ! -d "$COV_INSTALL_DIR" ] || [ ! -f "${COV_BIN_DIR}/cov-configure" ]; then
  log "Coverity not found or incomplete. Installing Coverity $COV_VERSION..."
  
  # Download Coverity installer
  INSTALLER_PATH="${THIRDPARTY_DIR}/cov-analysis-linux64-${COV_VERSION}.sh"
  if [ ! -f "$INSTALLER_PATH" ]; then
    log "Downloading Coverity installer..."
    mkdir -p "$(dirname "$INSTALLER_PATH")"
    
    # Download the installer
    log "Downloading Coverity installer from $COV_INSTALLER_URL..."
    if ! curl --insecure -f -o "$INSTALLER_PATH" "$COV_INSTALLER_URL" >> "$LOG_FILE" 2>&1; then
      log "ERROR: Failed to download Coverity installer."
      log "  - Check network connectivity"
      log "  - Verify URL accessibility: $COV_INSTALLER_URL"
      log "  - Check proxy settings if applicable"
      exit 1
    fi
    
    chmod +x "$INSTALLER_PATH"
  fi
  
  # Download license file if needed
  if [ ! -f "$COV_LICENSE_FILE" ]; then
    log "Downloading Coverity license..."
    mkdir -p "$(dirname "$COV_LICENSE_FILE")"
    
    # Download the license file
    log "Downloading Coverity license from $COV_LICENSE_URL..."
    if ! curl --insecure -f -o "$COV_LICENSE_FILE" "$COV_LICENSE_URL" >> "$LOG_FILE" 2>&1; then
      log "ERROR: Failed to download Coverity license."
      log "  - Check network connectivity"
      log "  - Verify URL accessibility: $COV_LICENSE_URL"
      log "  - Check proxy settings if applicable"
      exit 1
    fi
    
    if [ ! -f "$COV_LICENSE_FILE" ]; then
      log "ERROR: Failed to create Coverity license file at $COV_LICENSE_FILE"
      exit 1
    fi
    
    # Verify and fix permissions on downloaded license file
    if ! verify_and_fix_license_permissions "$COV_LICENSE_FILE"; then
      log "ERROR: Failed to set proper permissions on license file"
      exit 1
    fi
  fi
  
  # Install Coverity
  log "Installing Coverity..."
  mkdir -p "$COV_INSTALL_DIR"
  
  # Set up installation options for unattended installation
  INSTALL_OPTIONS=(
    "-q"
    "--installation.dir=${COV_INSTALL_DIR}"
    "--license.agreement=agree"
    "--license.region=0"
    "--license.type.choice=0"
    "--license.cov.path=${COV_LICENSE_FILE}"
    "--component.sdk=false"
    "--component.skip.documentation=true"
  )
  
  # Execute the installer with unattended options
  log "Running Coverity installer with unattended options..."
  if ! $INSTALLER_PATH "${INSTALL_OPTIONS[@]}" >> "$LOG_FILE" 2>&1; then
    log "ERROR: Failed to install Coverity. Check installation logs for details."
    exit 1
  fi
  
  # Verify that all required binaries are present
  if ! verify_coverity_installation; then
    log "ERROR: Coverity installation is incomplete or corrupted."
    exit 1
  fi
  
  # Copy license file to bin directory after installation
  if [ -f "$COV_LICENSE_FILE" ]; then
    log "Copying license file to Coverity bin directory post-installation..."
    cp -f "$COV_LICENSE_FILE" "$COV_BIN_LICENSE_FILE"
    chmod 644 "$COV_BIN_LICENSE_FILE"
    log "License file copied to $COV_BIN_LICENSE_FILE with correct permissions"
  fi
  
  log "Coverity installed successfully at $COV_INSTALL_DIR"
  
  # Clean up installer file to save disk space
  if [ -f "$INSTALLER_PATH" ]; then
    log "Removing Coverity installer archive to save disk space..."
    rm -f "$INSTALLER_PATH"
    log "Installer archive removed."
  fi
fi

# Verify Coverity installation regardless of whether it was just installed or already existed
if ! verify_coverity_installation; then
  log "ERROR: Coverity installation is incomplete or corrupted."
  exit 1
fi

# Set environment variables for Coverity
export COVERITY_LICENSE_FILE="$COV_LICENSE_FILE"

log "License environment variables set:"
log "  - COVERITY_LICENSE_FILE=$COVERITY_LICENSE_FILE"

# Copy license file to Coverity bin directory
if [ -f "$COV_LICENSE_FILE" ]; then
  log "Copying license file to Coverity bin directory..."
  # Create bin directory if it doesn't exist
  mkdir -p "$COV_BIN_DIR"
  
  # Copy the license file to the bin directory
  cp -f "$COV_LICENSE_FILE" "$COV_BIN_LICENSE_FILE"
  
  # Set appropriate permissions (readable by all, writable by owner)
  chmod 644 "$COV_BIN_LICENSE_FILE"
  
  log "License file copied to $COV_BIN_LICENSE_FILE with correct permissions"
else
  log "WARNING: License file not found at $COV_LICENSE_FILE. Coverity analysis may fail."
fi

# Verify license file exists and is valid
verify_license_file "$COV_LICENSE_FILE"
license_status=$?

if [ $license_status -eq 1 ]; then
  log "ERROR: Fatal license file issues detected. Cannot continue."
  exit 1
else
  log "License file verification passed."
fi

# Configure Coverity for each language
log "Configuring Coverity for specified languages..."
mkdir -p "$REPORT_DIR"

for lang in "${LANG_ARRAY[@]}"; do
  # Build the full command
  CONFIG_CMD="${COV_BIN_DIR}/cov-configure --${lang} --config ${COV_CONFIG_FILE}"
  
  # Log the command with description
  log_cmd "Configuring Coverity for ${lang}" "$CONFIG_CMD"
  
  # Execute the command
  if ! eval "$CONFIG_CMD" >> "$LOG_FILE" 2>&1; then
    log "ERROR: Failed to configure Coverity for $lang"
    log "  - Check log file for detailed error messages: $LOG_FILE"
    log "  - Verify that Coverity supports the $lang language"
    log "  - Ensure proper permissions for the configuration file: $COV_CONFIG_FILE"
    exit 1
  fi
  
  log "Successfully configured Coverity for $lang"
done

# Run Coverity build (capture)
log "Running Coverity capture..."

# Build the full command
LANG_ARGS=$(printf -- '--language %s ' "${LANGUAGES//,/ }")
BUILD_CMD="${COV_BIN_DIR}/coverity capture --dir ${COV_CAPTURE_DIR} ${LANG_ARGS}--project-dir ${PACKAGE_DIR}"

# Log the command with description
log_cmd "Running Coverity capture" "$BUILD_CMD"

# Execute the command
if ! eval "$BUILD_CMD" >> "$LOG_FILE" 2>&1; then
  log "ERROR: Failed to run Coverity capture"
  log "  - Check log file for detailed error messages: $LOG_FILE"
  log "  - Verify that the package directory exists: $PACKAGE_DIR"
  log "  - Ensure proper permissions for the capture directory: $COV_CAPTURE_DIR"
  exit 1
fi

log "Coverity build/capture completed successfully"

# Run Coverity analysis
log "Running Coverity analysis..."

# Ensure license file is set correctly before analysis
if [ ! -f "$COV_BIN_LICENSE_FILE" ]; then
  log "WARNING: Coverity license file not found in bin directory at $COV_BIN_LICENSE_FILE"
  
  # Try to copy it again if the main license file exists
  if [ -f "$COV_LICENSE_FILE" ]; then
    log "Copying license file to Coverity bin directory before analysis..."
    cp -f "$COV_LICENSE_FILE" "$COV_BIN_LICENSE_FILE"
    chmod 644 "$COV_BIN_LICENSE_FILE"
    log "License file copied to $COV_BIN_LICENSE_FILE with correct permissions"
  else
    log "ERROR: Main license file not found at $COV_LICENSE_FILE"
    exit 1
  fi
fi

# Verify bin directory license file permissions
if [ -f "$COV_BIN_LICENSE_FILE" ]; then
  
  if ! verify_and_fix_license_permissions "$COV_BIN_LICENSE_FILE"; then
    log "ERROR: Failed to set proper permissions on bin directory license file"
    exit 1
  fi
else
  log "ERROR: Bin directory license file not found at $COV_BIN_LICENSE_FILE"
  exit 1
fi

# Set license environment variables explicitly - prioritize bin directory license
export COVERITY_LICENSE_FILE="$COV_BIN_LICENSE_FILE"
log "License environment variables updated:"
log "  - COVERITY_LICENSE_FILE=$COVERITY_LICENSE_FILE"

# Build the full command with all options
ANALYZE_CMD="${COV_BIN_DIR}/cov-analyze --dir ${COV_CAPTURE_DIR} --strip-path \"$(realpath "${PACKAGE_DIR}")\" \
  --enable-default --security --webapp-security --enable-audit-checkers \
  --enable-audit-mode --webapp-security --checker-option DOM_XSS:distrust_all:true"

# Log the command with description
log_cmd "Running Coverity analysis with these options" "$ANALYZE_CMD"

# Execute the command
eval "$ANALYZE_CMD" >> "$LOG_FILE" 2>&1
ANALYZE_EXIT_CODE=$?

# Check for the license error specifically
if grep -q "No Static Analysis or Prevent licenses were found" "$LOG_FILE"; then
  log "ERROR: License issue detected - No Static Analysis or Prevent licenses were found"
  log "  - Verify the license file is valid: $COV_LICENSE_FILE"
  log "  - Check that the license file contains valid entries"
  log "  - Ensure the license has not expired"
  log "  - Confirm license server is accessible (if using a license server)"
  log "  - Exit code: $ANALYZE_EXIT_CODE"
  exit 1
elif [ $ANALYZE_EXIT_CODE -ne 0 ]; then
  log "ERROR: Failed to run Coverity analysis."
  log "  - Check log file for detailed error messages: $LOG_FILE"
  log "  - Verify that the code in $PACKAGE_DIR is valid and can be analyzed"
  log "  - Ensure proper permissions for the capture directory: $COV_CAPTURE_DIR"
  log "  - Exit code: $ANALYZE_EXIT_CODE"
  exit 1
fi

log "Coverity analysis completed successfully"

# Generate HTML report
log "Generating HTML report..."

# Build the full command
HTML_CMD="${COV_BIN_DIR}/cov-format-errors --dir ${COV_CAPTURE_DIR} --html-output ${REPORT_DIR}/html"

# Log the command with description
log_cmd "Generating HTML report" "$HTML_CMD"

# Execute the command
eval "$HTML_CMD" >> "$LOG_FILE" 2>&1

HTML_CMD_EXIT_CODE=$?
if [ $HTML_CMD_EXIT_CODE -ne 0 ]; then
  log "ERROR: Failed to generate HTML report."
  log "  - Check log file for detailed error messages: $LOG_FILE"
  log "  - Verify that the analysis has been completed successfully"
  log "  - Ensure proper permissions for the report directory: $REPORT_DIR"
  exit 1
fi

log "HTML report generated successfully at ${REPORT_DIR}/html"

# Generate text report
log "Generating text report..."

# Build the full command
TEXT_CMD="${COV_BIN_DIR}/cov-format-errors --dir ${COV_CAPTURE_DIR} --file ${REPORT_DIR}/coverity_findings.txt"

# Log the command with description
log_cmd "Generating text report" "$TEXT_CMD"

# Execute the command
if ! eval "$TEXT_CMD" >> "$LOG_FILE" 2>&1; then
  log "ERROR: Failed to generate text report."
  log "  - Check log file for detailed error messages: $LOG_FILE"
  log "  - Verify that the analysis has been completed successfully"
  log "  - Ensure proper permissions for the report directory: $REPORT_DIR"
  exit 1
fi

log "Text report generated successfully at ${REPORT_DIR}/coverity_findings.txt"

# Count defects from XML summary
DEFECT_COUNT=0
if [ -f "$REPORT_DIR/html/summary.xml" ]; then
  # Extract total defect count from XML summary
  # Look for the Total checker entry and extract the num value
  DEFECT_COUNT=$(grep -A3 "<checker>Total</checker>" "$REPORT_DIR/html/summary.xml" | grep "<num>" | sed 's/<[^>]*>//g' | tr -d ' \t\n\r' 2>/dev/null || echo "0")
  
  # Ensure DEFECT_COUNT is a valid integer
  if ! [[ "$DEFECT_COUNT" =~ ^[0-9]+$ ]]; then
    log "WARNING: Could not parse defect count from XML, defaulting to 0"
    DEFECT_COUNT=0
  fi
  
  log "Coverity scan complete. Found $DEFECT_COUNT potential issues (from XML summary)."
else
  log "WARNING: XML summary file not found at $REPORT_DIR/html/summary.xml"
  log "Coverity scan complete. Defect count unavailable."
fi
log "Reports available in: $REPORT_DIR"

# Create summary file
SUMMARY_FILE="$REPORT_DIR/summary.txt"
{
  echo "========================================================"
  echo "                COVERITY SCAN SUMMARY                   "
  echo "========================================================"
  echo "Date: $(date)"
  echo "Package scanned: $PACKAGE_DIR"
  echo "Languages: $LANGUAGES"
  echo "Coverity version: $COV_VERSION"
  echo ""
  echo "RESULTS:"
  echo "Total defects found: $DEFECT_COUNT"
  echo ""
  
  # Extract defect categories from XML summary if available
  if [ -f "$REPORT_DIR/html/summary.xml" ] && [ "$DEFECT_COUNT" -gt 0 ]; then
    echo "Defect categories:"
    # Parse XML to show checker types and counts (excluding Total)
    # Use awk to properly parse the XML structure
    # Alternative simpler approach if awk fails
    if ! awk '
    /<checker>/ && !/<checker>Total<\/checker>/ {
      getline; getline; getline; 
      if (/<num>/) {
        checker_line = $0
        gsub(/<[^>]*>/, "", checker_line)
        getline
        if (/<num>/) {
          num_line = $0
          gsub(/<[^>]*>/, "", num_line)
          gsub(/[ \t\n\r]/, "", checker_line)
          gsub(/[ \t\n\r]/, "", num_line)
          if (length(checker_line) > 0 && length(num_line) > 0) {
            print "  - " checker_line ": " num_line
          }
        }
      }
    }' "$REPORT_DIR/html/summary.xml" 2>/dev/null; then
      # Extract each checker block manually
      grep -B1 -A3 "<checker>" "$REPORT_DIR/html/summary.xml" | grep -v "Total" | \
      sed -n 's/<checker>\(.*\)<\/checker>/\1/p' | while read -r checker; do
        if [ -n "$checker" ]; then
          # Find the corresponding num for this checker
          count=$(grep -A3 "<checker>$checker</checker>" "$REPORT_DIR/html/summary.xml" | grep "<num>" | sed 's/<[^>]*>//g' | tr -d ' \t\n\r')
          if [[ "$count" =~ ^[0-9]+$ ]]; then
            echo "  - $checker: $count"
          fi
        fi
      done
    fi
    echo ""
  else
    echo "No defect categories available"
    echo ""
  fi
  
  echo "Detailed reports:"
  echo "  - HTML: $REPORT_DIR/html/index.html"
  echo "  - XML Summary: $REPORT_DIR/html/summary.xml"
  if [ -f "$REPORT_DIR/coverity_findings.txt" ]; then
    echo "  - Text: $REPORT_DIR/coverity_findings.txt"
  fi
  echo "  - Log file: $LOG_FILE"
  echo "========================================================"
} > "$SUMMARY_FILE"

# Exit with status based on defect count
if [ "$DEFECT_COUNT" -gt 0 ]; then
  log "Scan completed with $DEFECT_COUNT issues detected. Check $SUMMARY_FILE for details."
  exit 100  # Non-zero but distinguishable from script errors
else
  log "Scan completed successfully with no issues detected."
  exit 0
fi