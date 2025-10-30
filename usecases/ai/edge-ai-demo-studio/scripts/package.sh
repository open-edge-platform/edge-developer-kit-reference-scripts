#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
# Exit immediately if a command exits with a non-zero status
set -e

# Define variables
TEMP_DIR="../build"
WORKER_DIR="../workers"
FRONTEND_DIR="../frontend"
ELECTRON_DIR="../electron"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

NODE_PATH="$(cd "$SCRIPT_DIR/../thirdparty/node/bin" && pwd)"

setup_node_env() {
    OLD_PATH="$PATH"
    echo " Setting up Node.js environment..."
    if [ ! -d "$NODE_PATH" ]; then
        echo "Error:Node.js not found in $NODE_PATH. Please run setup.sh in the project root first."
        exit 1
    fi
    export PATH="$NODE_PATH:$PATH"
    trap reset_env EXIT
    # Check for node and npm
    if ! command -v node >/dev/null 2>&1; then
        echo "Error:node is not available in PATH."
        exit 1
    fi
    if ! command -v npm >/dev/null 2>&1; then
        echo "Error:npm is not available in PATH."
        exit 1
    fi
    echo " Node.js version: $(node -v)"
    echo " npm version: $(npm -v)"
}

reset_env() {
    echo "Resetting environment variables..."
    export PATH="$OLD_PATH"
}

copy_workers() {
  # Copy worker files to the temporary directory
  echo "Copying worker files to temporary directory..."
  mkdir -p "$TEMP_DIR/workers" || { echo "Failed to create workers folder in temp directory."; exit 1; }
  rsync -av --exclude='.venv' --exclude='thirdparty' --exclude='__pycache__' --exclude='models' --exclude='avatars' "$WORKER_DIR/" "$TEMP_DIR/workers" || { echo "Failed to copy worker files."; exit 1; }
  echo "Worker files copied successfully."
}

copy_scripts() {
  # Copy scripts to the temporary directory
  echo "Copying scripts to temporary directory..."
  mkdir -p "$TEMP_DIR/scripts" || { echo "Failed to create scripts folder in temp directory."; exit 1; }
  for script in "$SCRIPT_DIR"/*.sh; do
    [ "$(basename "$script")" = "package.sh" ] && continue
    cp "$script" "$TEMP_DIR/scripts" || { echo "Failed to copy $script."; exit 1; }
  done
  echo "Scripts copied successfully."
}

finalize_package() {
  # Copy distribution files to the final output directory and create zip
  echo "Finalizing package..."
  
  # Determine the output folder name (assuming Linux build for now)
  OUT_FOLDER="$SCRIPT_DIR/../out/linux-unpacked"
  
  if [ ! -d "$OUT_FOLDER" ]; then
    echo "Error: Output folder not found at $OUT_FOLDER"
    exit 1
  fi
  
  # Create the new EdgeAIDemoStudio package structure
  echo "Creating EdgeAIDemoStudio package structure..."
  cd "$SCRIPT_DIR/../out"
  
  # Remove existing EdgeAIDemoStudio directory if it exists
  if [ -d "EdgeAIDemoStudio" ]; then
    rm -rf EdgeAIDemoStudio
    echo "Removed existing EdgeAIDemoStudio directory"
  fi
  
  # Create EdgeAIDemoStudio directory
  mkdir -p EdgeAIDemoStudio
  
  # Copy README.md to the root of EdgeAIDemoStudio
  if [ -f "$SCRIPT_DIR/../out/README.md" ]; then
    cp "$SCRIPT_DIR/../out/README.md" EdgeAIDemoStudio/ || { echo "Failed to copy README.md to EdgeAIDemoStudio folder."; exit 1; }
    echo "README.md copied to EdgeAIDemoStudio root successfully."
  fi
  
  # Copy install_dependencies.sh to the root of EdgeAIDemoStudio
  if [ -f "$SCRIPT_DIR/../install_dependencies.sh" ]; then
    cp "$SCRIPT_DIR/../install_dependencies.sh" EdgeAIDemoStudio/ || { echo "Failed to copy install_dependencies.sh to EdgeAIDemoStudio folder."; exit 1; }
    echo "install_dependencies.sh copied to EdgeAIDemoStudio root successfully."
  fi
  
  # Copy run_web.sh to the root of EdgeAIDemoStudio
  if [ -f "$SCRIPT_DIR/../out/run_web.sh" ]; then
    cp "$SCRIPT_DIR/../out/run_web.sh" EdgeAIDemoStudio/ || { echo "Failed to copy run_web.sh to EdgeAIDemoStudio folder."; exit 1; }
    echo "run_web.sh copied to EdgeAIDemoStudio root successfully."
  fi

  # Copy run_web.sh to the root of EdgeAIDemoStudio
  if [ -f "$SCRIPT_DIR/../out/setup.sh" ]; then
    cp "$SCRIPT_DIR/../out/setup.sh" EdgeAIDemoStudio/ || { echo "Failed to copy setup.sh to EdgeAIDemoStudio folder."; exit 1; }
    echo "setup.sh copied to EdgeAIDemoStudio root successfully."
  fi
  
  # Copy the entire edge-ai-demo-studio-linux-x64 directory into EdgeAIDemoStudio
  cp -r linux-unpacked EdgeAIDemoStudio/ || { echo "Failed to copy linux-unpacked to EdgeAIDemoStudio folder."; exit 1; }
  echo "linux-unpacked directory copied successfully."
  
  # Create a shell script launcher that launches the application correctly
  cd EdgeAIDemoStudio
  cat > EdgeAIDemoStudio << 'EOF'
#!/usr/bin/env bash

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Define the path to the executable
EXECUTABLE="$SCRIPT_DIR/linux-unpacked/edge-ai-demo-studio"

# Check if the executable exists
if [ ! -f "$EXECUTABLE" ]; then
    echo "Error: EdgeAIDemoStudio executable not found at $EXECUTABLE"
    exit 1
fi

# Launch the application
echo "Starting EdgeAIDemoStudio..."
exec "$EXECUTABLE" "$@"
EOF
  chmod +x EdgeAIDemoStudio || { echo "Failed to make launcher script executable."; exit 1; }
  echo "EdgeAIDemoStudio launcher script created successfully."
  cd ..
  
  # Create zip file with the new structure
  echo "Creating EdgeAIDemoStudio.zip..."
  if [ -f "EdgeAIDemoStudio.zip" ]; then
    rm EdgeAIDemoStudio.zip
    echo "Removed existing EdgeAIDemoStudio.zip"
  fi
  zip -r EdgeAIDemoStudio.zip EdgeAIDemoStudio/ || { echo "Failed to create zip file."; exit 1; }
  echo "EdgeAIDemoStudio.zip created successfully."
  cd -
}

setup_frontend_package() {
  # Build the frontend application
  if [ -d "$FRONTEND_DIR" ]; then
    echo "Building frontend application..."
    cd "$FRONTEND_DIR"
    npm install || { echo "Frontend dependencies installation failed."; exit 1; }
    npm run build || { echo "Frontend build failed."; exit 1; }
    rsync -av .next/standalone/ "$TEMP_DIR/frontend/" || { echo "Failed to copy standalone frontend build files to temp directory."; exit 1; }
    rsync -av .next/static/ "$TEMP_DIR/frontend/.next/static/" || { echo "Failed to copy static frontend build files to temp directory."; exit 1; }
    cd -
  else
    echo "Frontend directory not found. Exiting..."
    exit 1
  fi
}

create_temp_dir() {
  # Create a temporary directory for worker files
  if [ -d "$TEMP_DIR" ]; then
    echo "Temporary directory already exists. Cleaning up..."
    rm -rf "$TEMP_DIR"
  else
    echo "Temporary directory does not exist. Creating..."
  fi
  mkdir -p "$TEMP_DIR"
  echo "Temporary directory created at $TEMP_DIR"
}

run_electron_package() {
  # Package the Electron application
  if [ -d "$ELECTRON_DIR" ]; then
    echo "Packaging Electron application..."
    cd "$ELECTRON_DIR"
    npm run build:dir || { echo "Electron packaging failed."; exit 1; }
    cd -
  else
    echo "Electron directory not found. Exiting..."
    exit 1
  fi
}

main() {
  cd "$SCRIPT_DIR"
  create_temp_dir
  setup_node_env
  copy_workers
  copy_scripts
  setup_frontend_package
  run_electron_package
  finalize_package
  reset_env

  echo "Packaging completed successfully. Files are available in $SCRIPT_DIR/../out"
  echo "Zip file created: $SCRIPT_DIR/../out/EdgeAIDemoStudio.zip"
}

main