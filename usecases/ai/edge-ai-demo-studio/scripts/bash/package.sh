#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
# Exit immediately if a command exits with a non-zero status
set -e

# Define variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../" && pwd)"
TEMP_DIR="$PROJECT_DIR/build"
WORKER_DIR="$PROJECT_DIR/workers"
FRONTEND_DIR="$PROJECT_DIR/frontend"
ELECTRON_DIR="$PROJECT_DIR/electron"

NODE_PATH="$(cd "$PROJECT_DIR/thirdparty/node/bin" && pwd)"

# Validate required system tools
validate_system_requirements() {
    echo "Validating system requirements..."
    local MISSING_TOOLS=()
    
    # Check for rsync
    if ! command -v rsync >/dev/null 2>&1; then
        MISSING_TOOLS+=("rsync")
    fi
    
    # Check for zip
    if ! command -v zip >/dev/null 2>&1; then
        MISSING_TOOLS+=("zip")
    fi
    
    # Check for stat (should be available on all systems)
    if ! command -v stat >/dev/null 2>&1; then
        echo "Warning: stat command not available. File size reporting may be limited."
    fi
    
    if [ ${#MISSING_TOOLS[@]} -gt 0 ]; then
        echo "Error: The following required tools are missing:"
        for tool in "${MISSING_TOOLS[@]}"; do
            echo "  - $tool"
        done
        echo ""
        echo "Please install the missing tools:"
        echo "On Ubuntu/Debian: sudo apt-get install ${MISSING_TOOLS[*]}"
        echo "On Fedora/RHEL: sudo dnf install ${MISSING_TOOLS[*]}"
        echo "On macOS: brew install ${MISSING_TOOLS[*]}"
        exit 1
    fi
    
    echo "✓ All required system tools are available."
}

setup_node_env() {
    OLD_PATH="$PATH"
    echo "Setting up Node.js environment..."
    
    if [ ! -d "$NODE_PATH" ]; then
        echo "Error: Node.js not found in $NODE_PATH"
        echo "Please run setup.sh in the project root first to install Node.js."
        exit 1
    fi
    
    export PATH="$NODE_PATH:$PATH" || { echo "Error: Failed to set PATH environment variable."; exit 1; }
    trap reset_env EXIT
    
    # Check for node and npm
    if ! command -v node >/dev/null 2>&1; then
        echo "Error: node is not available in PATH after setup."
        echo "PATH: $PATH"
        exit 1
    fi
    
    if ! command -v npm >/dev/null 2>&1; then
        echo "Error: npm is not available in PATH after setup."
        echo "PATH: $PATH"
        exit 1
    fi
    
    NODE_VERSION=$(node -v 2>&1) || { echo "Error: Failed to get Node.js version."; exit 1; }
    NPM_VERSION=$(npm -v 2>&1) || { echo "Error: Failed to get npm version."; exit 1; }
    
    echo "✓ Node.js version: $NODE_VERSION"
    echo "✓ npm version: $NPM_VERSION"
}

reset_env() {
    echo "Resetting environment variables..."
    export PATH="$OLD_PATH"
}

copy_workers() {
  echo "Copying worker files to temporary directory..."
  
  # Verify source directory exists
  if [ ! -d "$WORKER_DIR" ]; then
      echo "Error: Worker directory not found at $WORKER_DIR"
      exit 1
  fi
  
  # Check if rsync is available
  if ! command -v rsync >/dev/null 2>&1; then
      echo "Error: rsync is not installed. Please install rsync to continue."
      exit 1
  fi
  
  # Create workers folder in temp directory
  mkdir -p "$TEMP_DIR/workers" || { 
      echo "Error: Failed to create workers folder at $TEMP_DIR/workers"
      echo "Check permissions and available disk space."
      exit 1
  }
  
  # Copy worker files with rsync
  rsync -av --exclude='.venv' --exclude='thirdparty' --exclude='__pycache__' --exclude='models' --exclude='avatars' "$WORKER_DIR/" "$TEMP_DIR/workers" || { 
      echo "Error: Failed to copy worker files from $WORKER_DIR to $TEMP_DIR/workers"
      echo "Check source directory permissions and available disk space."
      exit 1
  }
  
  # Verify the copy was successful
  if [ ! -d "$TEMP_DIR/workers" ] || [ -z "$(ls -A "$TEMP_DIR/workers")" ]; then
      echo "Error: Worker files were not copied successfully. Destination directory is empty."
      exit 1
  fi
  
  echo "✓ Worker files copied successfully."
}

copy_scripts() {
  echo "Copying scripts to temporary directory..."
  
  # Create scripts folder in temp directory
  mkdir -p "$TEMP_DIR/scripts" || { 
      echo "Error: Failed to create scripts folder at $TEMP_DIR/scripts"
      echo "Check permissions and available disk space."
      exit 1
  }
  
  # Preserve the original scripts/ directory structure when copying.
  if [ -d "$PROJECT_DIR/scripts" ]; then
      echo "Copying scripts from $PROJECT_DIR/scripts..."
      
      # Copy only .sh files while preserving directory structure.
      rsync -av --prune-empty-dirs \
        --include='*/' \
        --include='*.sh' \
        --exclude='.venv/' \
        --exclude='thirdparty/' \
        --exclude='__pycache__/' \
        --exclude='*' \
        "$PROJECT_DIR/scripts/" "$TEMP_DIR/scripts/" || { 
            echo "Error: Failed to copy scripts directory from $PROJECT_DIR/scripts to $TEMP_DIR/scripts"
            echo "Check source directory permissions and available disk space."
            exit 1
        }
      
      # Verify at least some files were copied
      if [ ! -d "$TEMP_DIR/scripts" ] || [ -z "$(find "$TEMP_DIR/scripts" -name "*.sh" 2>/dev/null)" ]; then
          echo "Warning: No .sh files found in copied scripts directory."
      fi
  else
      echo "Scripts directory not found at $PROJECT_DIR/scripts. Attempting fallback..."
      
      # Fallback: copy top-level shell scripts except this packager
      SCRIPT_COUNT=0
      for script in "$PROJECT_DIR"/*.sh; do
        if [ -f "$script" ]; then
          [ "$(basename "$script")" = "package.sh" ] && continue
          cp "$script" "$TEMP_DIR/scripts" || { 
              echo "Error: Failed to copy $script to $TEMP_DIR/scripts"
              echo "Check file permissions and available disk space."
              exit 1
          }
          SCRIPT_COUNT=$((SCRIPT_COUNT + 1))
        fi
      done
      
      if [ $SCRIPT_COUNT -eq 0 ]; then
          echo "Warning: No shell scripts found to copy in fallback mode."
      else
          echo "Copied $SCRIPT_COUNT shell script(s) in fallback mode."
      fi
  fi
  
  # Copy root setup.sh to the build directory
  echo "Copying root setup.sh."
  if [ -f "$PROJECT_DIR/setup.sh" ]; then
    cp "$PROJECT_DIR/setup.sh" "$TEMP_DIR/" || {
      echo "Error: Failed to copy setup.sh from project root"
      exit 1
    }
    echo "✓ Root setup.sh copied successfully."
  else
    echo "Warning: setup.sh not found in project root"
  fi
  
  echo "✓ Scripts copied successfully."
}

finalize_package() {
  echo "Finalizing package..."
  
  # Verify output directory exists
  if [ ! -d "$PROJECT_DIR/out" ]; then
      echo "Error: Output directory not found at $PROJECT_DIR/out"
      echo "The Electron build may have failed. Check previous build steps."
      exit 1
  fi
  
  # Determine the output folder name (assuming Linux build for now)
  OUT_FOLDER="$PROJECT_DIR/out/linux-unpacked"
  
  if [ ! -d "$OUT_FOLDER" ]; then
    echo "Error: Output folder not found at $OUT_FOLDER"
    echo "The Electron build did not create the expected linux-unpacked directory."
    echo "Available directories in out/:"
    ls -la "$PROJECT_DIR/out/" 2>/dev/null || echo "Unable to list directory contents."
    exit 1
  fi
  
  # Create the new EdgeAIDemoStudio package structure
  echo "Creating EdgeAIDemoStudio package structure..."
  
  cd "$PROJECT_DIR/out" || {
      echo "Error: Failed to change directory to $PROJECT_DIR/out"
      exit 1
  }
  
  # Remove existing EdgeAIDemoStudio directory if it exists
  if [ -d "EdgeAIDemoStudio" ]; then
    rm -rf EdgeAIDemoStudio || {
        echo "Error: Failed to remove existing EdgeAIDemoStudio directory"
        echo "Check directory permissions."
        exit 1
    }
    echo "Removed existing EdgeAIDemoStudio directory"
  fi
  
  # Create EdgeAIDemoStudio directory
  mkdir -p EdgeAIDemoStudio || {
      echo "Error: Failed to create EdgeAIDemoStudio directory"
      echo "Check permissions and available disk space."
      exit 1
  }
  
  # Copy README.md to the root of EdgeAIDemoStudio
  if [ -f "$PROJECT_DIR/out/README.md" ]; then
    cp "$PROJECT_DIR/out/README.md" EdgeAIDemoStudio/ || { 
        echo "Error: Failed to copy README.md to EdgeAIDemoStudio folder."
        echo "Check file permissions and available disk space."
        exit 1
    }
    echo "✓ README.md copied to EdgeAIDemoStudio root successfully."
  else
    echo "Warning: README.md not found at $PROJECT_DIR/out/README.md - skipping."
  fi
  
  # Copy install_dependencies.sh to the root of EdgeAIDemoStudio
  if [ -f "$PROJECT_DIR/install_dependencies.sh" ]; then
    cp "$PROJECT_DIR/install_dependencies.sh" EdgeAIDemoStudio/ || { 
        echo "Error: Failed to copy install_dependencies.sh to EdgeAIDemoStudio folder."
        echo "Check file permissions and available disk space."
        exit 1
    }
    echo "✓ install_dependencies.sh copied to EdgeAIDemoStudio root successfully."
  else
    echo "Warning: install_dependencies.sh not found at $PROJECT_DIR/install_dependencies.sh - skipping."
  fi
  
  # Copy setup.sh and start_web.sh from out/ to EdgeAIDemoStudio
  echo "Copying setup.sh and start_web.sh..."
  if [ -f "$PROJECT_DIR/out/setup.sh" ]; then
    cp "$PROJECT_DIR/out/setup.sh" EdgeAIDemoStudio/ || { 
        echo "Error: Failed to copy setup.sh to EdgeAIDemoStudio folder."
        echo "Check file permissions and available disk space."
        exit 1
    }
    chmod +x EdgeAIDemoStudio/setup.sh || {
        echo "Error: Failed to make setup.sh executable"
        exit 1
    }
    echo "✓ setup.sh copied successfully."
  else
    echo "Warning: setup.sh not found at $PROJECT_DIR/out/setup.sh - skipping."
  fi

  if [ -f "$PROJECT_DIR/out/start_web.sh" ]; then
    cp "$PROJECT_DIR/out/start_web.sh" EdgeAIDemoStudio/ || { 
        echo "Error: Failed to copy start_web.sh to EdgeAIDemoStudio folder."
        echo "Check file permissions and available disk space."
        exit 1
    }
    chmod +x EdgeAIDemoStudio/start_web.sh || {
        echo "Error: Failed to make start_web.sh executable"
        exit 1
    }
    echo "✓ start_web.sh copied successfully."
  else
    echo "Warning: start_web.sh not found at $PROJECT_DIR/out/start_web.sh - skipping."
  fi
  
  # Copy the entire linux-unpacked directory into EdgeAIDemoStudio
  if [ ! -d "linux-unpacked" ]; then
      echo "Error: linux-unpacked directory not found in current directory"
      echo "Current directory: $(pwd)"
      exit 1
  fi
  
  cp -r linux-unpacked EdgeAIDemoStudio/ || { 
      echo "Error: Failed to copy linux-unpacked to EdgeAIDemoStudio folder."
      echo "Check directory permissions and available disk space."
      exit 1
  }
  echo "✓ linux-unpacked directory copied successfully."
  
  # Create a shell script launcher that launches the application correctly
  cd EdgeAIDemoStudio || {
      echo "Error: Failed to change directory to EdgeAIDemoStudio"
      exit 1
  }
  
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
  
  if [ ! -f "EdgeAIDemoStudio" ]; then
      echo "Error: Failed to create EdgeAIDemoStudio launcher script"
      exit 1
  fi
  
  chmod +x EdgeAIDemoStudio || { 
      echo "Error: Failed to make launcher script executable."
      echo "Check file permissions."
      exit 1
  }
  
  echo "✓ EdgeAIDemoStudio launcher script created successfully."
  
  cd .. || {
      echo "Error: Failed to change directory back to out/"
      exit 1
  }
  
  # Create zip file with the new structure
  echo "Creating EdgeAIDemoStudio.zip..."
  
  # Check if zip is available
  if ! command -v zip >/dev/null 2>&1; then
      echo "Error: zip is not installed. Please install zip to continue."
      echo "On Ubuntu/Debian: sudo apt-get install zip"
      exit 1
  fi
  
  if [ -f "EdgeAIDemoStudio.zip" ]; then
    rm EdgeAIDemoStudio.zip || {
        echo "Error: Failed to remove existing EdgeAIDemoStudio.zip"
        echo "Check file permissions."
        exit 1
    }
    echo "Removed existing EdgeAIDemoStudio.zip"
  fi
  
  # Verify EdgeAIDemoStudio directory exists before zipping
  if [ ! -d "EdgeAIDemoStudio" ]; then
      echo "Error: EdgeAIDemoStudio directory not found. Cannot create zip file."
      exit 1
  fi
  
  zip -r EdgeAIDemoStudio.zip EdgeAIDemoStudio/ || { 
      echo "Error: Failed to create zip file."
      echo "Check available disk space and permissions."
      exit 1
  }
  
  # Verify the zip file was created and has reasonable size
  if [ ! -f "EdgeAIDemoStudio.zip" ]; then
      echo "Error: EdgeAIDemoStudio.zip was not created successfully."
      exit 1
  fi
  
    ZIP_SIZE=$(stat -f%z "EdgeAIDemoStudio.zip" 2>/dev/null || stat -c%s "EdgeAIDemoStudio.zip" 2>/dev/null)
    if [ -z "$ZIP_SIZE" ] || [ "$ZIP_SIZE" -lt 1024 ]; then
      echo "Error: EdgeAIDemoStudio.zip appears to be empty or corrupted (size: $ZIP_SIZE bytes)."
      exit 1
  fi

    HUMAN_SIZE=$(numfmt --to=iec-i --suffix=B "$ZIP_SIZE" 2>/dev/null || echo "$ZIP_SIZE bytes")
    echo "✓ EdgeAIDemoStudio.zip created successfully (""$HUMAN_SIZE"")."
  
  cd - >/dev/null || {
      echo "Error: Failed to return to previous directory"
      exit 1
  }
}

setup_frontend_package() {
  echo "Building frontend application..."
  
  # Check if frontend directory exists
  if [ ! -d "$FRONTEND_DIR" ]; then
    echo "Error: Frontend directory not found at $FRONTEND_DIR"
    exit 1
  fi
  
  # Change to frontend directory
  cd "$FRONTEND_DIR" || {
      echo "Error: Failed to change directory to $FRONTEND_DIR"
      exit 1
  }
  
  # Check if setup script exists
  if [ ! -f "./setup.sh" ]; then
      echo "Error: Frontend setup.sh script not found at $FRONTEND_DIR/setup.sh"
      exit 1
  fi
  
  # Make setup script executable
  chmod +x ./setup.sh || {
      echo "Error: Failed to make setup.sh executable"
      exit 1
  }
  
  # Run frontend setup
  ./setup.sh || { 
      echo "Error: Frontend setup failed."
      echo "Check the frontend setup.sh script for errors."
      exit 1
  }
  
  # Verify build output exists
  if [ ! -d ".next/standalone" ]; then
      echo "Error: Frontend build failed. .next/standalone directory not found."
      echo "The Next.js build may have failed. Check the build output above."
      exit 1
  fi
  
  if [ ! -d ".next/static" ]; then
      echo "Error: Frontend build failed. .next/static directory not found."
      echo "The Next.js build may have failed. Check the build output above."
      exit 1
  fi
  
  # Create frontend directory in temp
  mkdir -p "$TEMP_DIR/frontend" || {
      echo "Error: Failed to create frontend directory at $TEMP_DIR/frontend"
      exit 1
  }
  
  # Copy standalone build files
  rsync -av .next/standalone/ "$TEMP_DIR/frontend/" || { 
      echo "Error: Failed to copy standalone frontend build files to temp directory."
      echo "Source: $FRONTEND_DIR/.next/standalone/"
      echo "Destination: $TEMP_DIR/frontend/"
      exit 1
  }
  
  # Create .next/static directory in temp
  mkdir -p "$TEMP_DIR/frontend/.next/static" || {
      echo "Error: Failed to create .next/static directory at $TEMP_DIR/frontend/.next/static"
      exit 1
  }
  
  # Copy static files
  rsync -av .next/static/ "$TEMP_DIR/frontend/.next/static/" || { 
      echo "Error: Failed to copy static frontend build files to temp directory."
      echo "Source: $FRONTEND_DIR/.next/static/"
      echo "Destination: $TEMP_DIR/frontend/.next/static/"
      exit 1
  }
  
  echo "✓ Frontend built and copied successfully."
  
  cd - >/dev/null || {
      echo "Error: Failed to return to previous directory"
      exit 1
  }
}

create_temp_dir() {
  echo "Setting up temporary build directory..."
  
  # Remove existing temp directory if it exists
  if [ -d "$TEMP_DIR" ]; then
    echo "Temporary directory already exists at $TEMP_DIR. Cleaning up..."
    rm -rf "$TEMP_DIR" || {
        echo "Error: Failed to remove existing temporary directory at $TEMP_DIR"
        echo "Check directory permissions and ensure no processes are using files in this directory."
        exit 1
    }
    echo "Cleaned up existing temporary directory."
  fi
  
  # Create new temp directory
  mkdir -p "$TEMP_DIR" || {
      echo "Error: Failed to create temporary directory at $TEMP_DIR"
      echo "Check parent directory permissions and available disk space."
      exit 1
  }
  
  # Verify directory was created
  if [ ! -d "$TEMP_DIR" ]; then
      echo "Error: Temporary directory was not created successfully at $TEMP_DIR"
      exit 1
  fi
  
  echo "✓ Temporary directory created at $TEMP_DIR"
}

run_electron_package() {
  echo "Packaging Electron application..."
  
  # Check if Electron directory exists
  if [ ! -d "$ELECTRON_DIR" ]; then
    echo "Error: Electron directory not found at $ELECTRON_DIR"
    exit 1
  fi
  
  # Change to Electron directory
  cd "$ELECTRON_DIR" || {
      echo "Error: Failed to change directory to $ELECTRON_DIR"
      exit 1
  }
  
  # Verify package.json exists
  if [ ! -f "package.json" ]; then
      echo "Error: package.json not found in Electron directory"
      exit 1
  fi

  # Install Electron packages
  echo "Running npm install..."
  npm install || { 
      echo "Error: Electron installation failed."
      echo "Check the npm output above for specific errors."
      exit 1
  }
  
  # Verify node_modules exists
  if [ ! -d "node_modules" ]; then
      echo "Error: node_modules not found in Electron directory"
      echo "Please run npm install in the Electron directory first."
      exit 1
  fi
  
  # Check if build:dir script exists in package.json
  if ! grep -q '"build:dir"' package.json; then
      echo "Error: build:dir script not found in package.json"
      echo "Please ensure the Electron package.json has a build:dir script defined."
      exit 1
  fi
  
  # Run Electron packaging
  echo "Running npm run build:dir..."
  npm run build:dir || { 
      echo "Error: Electron packaging failed."
      echo "Check the npm output above for specific errors."
      exit 1
  }
  
  # Verify the build output was created
  if [ ! -d "$PROJECT_DIR/out" ]; then
      echo "Error: Electron build did not create the expected output directory at $PROJECT_DIR/out"
      exit 1
  fi
  
  echo "✓ Electron application packaged successfully."
  
  cd - >/dev/null || {
      echo "Error: Failed to return to previous directory"
      exit 1
  }
}

main() {
  echo "============================================"
  echo "EdgeAIDemoStudio Packaging Script"
  echo "============================================"
  echo ""
  
  # Change to script directory
  cd "$SCRIPT_DIR" || {
      echo "Error: Failed to change to script directory: $SCRIPT_DIR"
      exit 1
  }
  
  # Verify project directory exists
  if [ ! -d "$PROJECT_DIR" ]; then
      echo "Error: Project directory not found at $PROJECT_DIR"
      exit 1
  fi
  
  echo "Project directory: $PROJECT_DIR"
  echo "Build directory: $TEMP_DIR"
  echo ""
  
  # Validate system requirements first
  validate_system_requirements || exit 1
  echo ""
  
  # Execute packaging steps
  create_temp_dir || exit 1
  setup_node_env || exit 1
  copy_workers || exit 1
  copy_scripts || exit 1
  setup_frontend_package || exit 1
  run_electron_package || exit 1
  finalize_package || exit 1
  
  echo ""
  echo "============================================"
  echo "✓ Packaging completed successfully!"
  echo "============================================"
  echo ""
  echo "Output location: $PROJECT_DIR/out"
  echo "Zip file: $PROJECT_DIR/out/EdgeAIDemoStudio.zip"
  echo ""
  
  # Display zip file size if possible
  if [ -f "$PROJECT_DIR/out/EdgeAIDemoStudio.zip" ]; then
      ZIP_SIZE=$(stat -f%z "$PROJECT_DIR/out/EdgeAIDemoStudio.zip" 2>/dev/null || stat -c%s "$PROJECT_DIR/out/EdgeAIDemoStudio.zip" 2>/dev/null)
      if [ -n "$ZIP_SIZE" ]; then
          HUMAN_SIZE=$(numfmt --to=iec-i --suffix=B "$ZIP_SIZE" 2>/dev/null || echo "$ZIP_SIZE bytes")
          echo "Package size: $HUMAN_SIZE"
      fi
  fi
}

main