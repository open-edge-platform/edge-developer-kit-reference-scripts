#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../" && pwd)"
TEMP_DIR="$PROJECT_DIR/build"
WORKER_DIR="$PROJECT_DIR/workers"
FRONTEND_DIR="$PROJECT_DIR/frontend"
ELECTRON_DIR="$PROJECT_DIR/electron"

NODE_PATH="$PROJECT_DIR/thirdparty/node/bin"
PROJECT_NAME="EdgeAIDemoStudio"

cleanup_on_exit() {
    if [ -n "${OLD_PATH:-}" ]; then
        export PATH="$OLD_PATH"
    fi
}
trap cleanup_on_exit EXIT INT TERM

validate_system_requirements() {
    echo "Validating system requirements..."
    local MISSING_TOOLS=()
    
    if ! command -v rsync >/dev/null 2>&1; then
        MISSING_TOOLS+=("rsync")
    fi
    
    if ! command -v zip >/dev/null 2>&1; then
        MISSING_TOOLS+=("zip")
    fi
    
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

# Args: <src_dir> <output_exclude_file>
generate_rsync_exclude_from_gitignore() {
    local SRC_DIR="$1"
    local OUT_FILE="$2"
    : > "$OUT_FILE" || { echo "Error: Failed to create exclude file $OUT_FILE"; return 1; }

    # Helper: append patterns from a gitignore file, optionally prefixing with a relative dir
    _append_from_file() {
        local FILE="$1"; local PREFIX="$2"
        sed -n 's/^[[:space:]]*//; /^[#[:space:]]*$/d; p' "$FILE" | while IFS= read -r PAT; do
            [ -z "$PAT" ] && continue
            case "$PAT" in
                !*) continue ;; # skip negation patterns
            esac
            PAT=${PAT#./}
            PAT=${PAT#/}
            if [ -n "$PREFIX" ]; then
                echo "$PREFIX/$PAT" >> "$OUT_FILE"
            else
                echo "$PAT" >> "$OUT_FILE"
            fi
        done
    }

    # Root .gitignore (patterns are typically project-root-relative)
    if [ -f "$PROJECT_DIR/.gitignore" ]; then
        _append_from_file "$PROJECT_DIR/.gitignore" ""
    fi

    # Per-directory .gitignore files under the source dir
    if [ -d "$SRC_DIR" ]; then
        find "$SRC_DIR" -type f -name .gitignore -print0 | while IFS= read -r -d '' IG; do
            IGDIR=$(dirname "$IG")
            if [ "$IGDIR" = "$SRC_DIR" ]; then
                PREFIX=""
            else
                PREFIX=${IGDIR#"$SRC_DIR"/}
            fi
            _append_from_file "$IG" "$PREFIX"
        done
    fi
}

copy_workers() {
  echo "Copying worker files to temporary directory..."
  
  if [ ! -d "$WORKER_DIR" ]; then
      echo "Error: Worker directory not found at $WORKER_DIR"
      exit 1
  fi
  
  if ! command -v rsync >/dev/null 2>&1; then
      echo "Error: rsync is not installed. Please install rsync to continue."
      exit 1
  fi
  
  mkdir -p "$TEMP_DIR/workers" || { 
      echo "Error: Failed to create workers folder at $TEMP_DIR/workers"
      echo "Check permissions and available disk space."
      exit 1
  }

  TMP_EXCLUDE="$TEMP_DIR/rsync_exclude_workers.txt"
  generate_rsync_exclude_from_gitignore "$WORKER_DIR" "$TMP_EXCLUDE" || { echo "Error: Failed to generate rsync exclude list for workers"; exit 1; }

  rsync -av --exclude-from="$TMP_EXCLUDE" "$WORKER_DIR/" "$TEMP_DIR/workers" || { 
      echo "Error: Failed to copy worker files from $WORKER_DIR to $TEMP_DIR/workers"
      echo "Check source directory permissions and available disk space."
      exit 1
  }

  rm -f "$TMP_EXCLUDE" || true
  
  if [ ! -d "$TEMP_DIR/workers" ] || [ -z "$(ls -A "$TEMP_DIR/workers")" ]; then
      echo "Error: Worker files were not copied successfully. Destination directory is empty."
      exit 1
  fi
  
  echo "✓ Worker files copied successfully."
}

copy_scripts() {
  echo "Copying scripts to temporary directory..."
  SCRIPTS_PATH="$PROJECT_DIR/scripts/bash"
  DESTINATION_PATH="$TEMP_DIR/scripts"
  
  mkdir -p "$DESTINATION_PATH" || { 
      echo "Error: Failed to create scripts folder at $DESTINATION_PATH"
      echo "Check permissions and available disk space."
      exit 1
  }
  
  if [ -d "$SCRIPTS_PATH" ]; then
      echo "Copying scripts from $SCRIPTS_PATH..."
      
      # Copy only .sh files while preserving directory structure.
      rsync -av --prune-empty-dirs \
        --include='*/' \
        --include='*.sh' \
        --exclude='.venv/' \
        --exclude='thirdparty/' \
        --exclude='__pycache__/' \
        --exclude='*' \
        "$SCRIPTS_PATH/" "$DESTINATION_PATH/" || { 
            echo "Error: Failed to copy scripts directory from $SCRIPTS_PATH to $DESTINATION_PATH"
            echo "Check source directory permissions and available disk space."
            exit 1
        }
      
      if [ ! -d "$DESTINATION_PATH" ] || [ -z "$(find "$DESTINATION_PATH" -name "*.sh" 2>/dev/null)" ]; then
          echo "Warning: No .sh files found in copied scripts directory."
      fi
  else
      echo "Scripts directory not found at $SCRIPTS_PATH. Attempting fallback..."
      
      # Fallback: copy top-level shell scripts except this packager
      SCRIPT_COUNT=0
      for script in "$PROJECT_DIR"/*.sh; do
        if [ -f "$script" ]; then
          [ "$(basename "$script")" = "package.sh" ] && continue
          cp "$script" "$DESTINATION_PATH" || { 
              echo "Error: Failed to copy $script to $DESTINATION_PATH"
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
  
  SCRIPTS_TO_COPY=(
    "$PROJECT_DIR/setup.sh"
    "$PROJECT_DIR/install_dependencies.sh"
  )

  for script in "${SCRIPTS_TO_COPY[@]}"; do
    if [ -f "$script" ]; then
      cp "$script" "$DESTINATION_PATH/" || { 
          echo "Error: Failed to copy $script to $DESTINATION_PATH"
          echo "Check file permissions and available disk space."
          exit 1
      }
      echo "✓ Copied $(basename "$script") successfully."
    else
      echo "Warning: $(basename "$script") not found at $script - skipping."
    fi
  done
  
  
  echo "✓ Scripts copied successfully."
}

# Copy deployment.json (if any), its example and docs into the build dir; electron-builder bundles
# them into resources/ (extraResources in electron/package.json) for the packaged frontend.
copy_deployment_config() {
  echo "Copying deployment.json to temporary directory..."

  if [ -f "$PROJECT_DIR/deployment.json" ]; then
    cp "$PROJECT_DIR/deployment.json" "$TEMP_DIR/" || {
        echo "Error: Failed to copy deployment.json to $TEMP_DIR"
        echo "Check file permissions and available disk space."
        exit 1
    }
    echo "✓ deployment.json copied successfully."
  else
    echo "No deployment.json at $PROJECT_DIR/deployment.json - the package applies no presets; services are added in the UI."
  fi

  if [ -f "$PROJECT_DIR/deployment.example.json" ]; then
    cp "$PROJECT_DIR/deployment.example.json" "$TEMP_DIR/" || {
        echo "Error: Failed to copy deployment.example.json to $TEMP_DIR"
        exit 1
    }
    echo "✓ deployment.example.json copied successfully."
  fi

  # The schema keeps the "$schema" reference working in editors; with deployment-config.md
  # shipped, the startup doc regeneration finds it unchanged and skips rewriting it.
  local DOC_FILE
  for DOC_FILE in deployment.schema.json deployment-config.md; do
    if [ -f "$PROJECT_DIR/docs/$DOC_FILE" ]; then
      mkdir -p "$TEMP_DIR/docs" || {
          echo "Error: Failed to create docs folder at $TEMP_DIR/docs"
          exit 1
      }
      cp "$PROJECT_DIR/docs/$DOC_FILE" "$TEMP_DIR/docs/" || {
          echo "Warning: Failed to copy $DOC_FILE - continuing without it."
      }
      echo "✓ $DOC_FILE copied successfully."
    fi
  done
}

finalize_package() {
  echo "Finalizing package..."
  
  if [ ! -d "$PROJECT_DIR/out" ]; then
      echo "Error: Output directory not found at $PROJECT_DIR/out"
      echo "The Electron build may have failed. Check previous build steps."
      exit 1
  fi
  
  OUT_FOLDER="$PROJECT_DIR/out/linux-unpacked"
  
  if [ ! -d "$OUT_FOLDER" ]; then
    echo "Error: Output folder not found at $OUT_FOLDER"
    echo "The Electron build did not create the expected linux-unpacked directory."
    echo "Available directories in out/:"
    ls -la "$PROJECT_DIR/out/" 2>/dev/null || echo "Unable to list directory contents."
    exit 1
  fi
  
    echo "Creating $PROJECT_NAME package structure..."
  
  cd "$PROJECT_DIR/out" || {
      echo "Error: Failed to change directory to $PROJECT_DIR/out"
      exit 1
  }
  
    if [ -d "$PROJECT_NAME" ]; then
        rm -rf "$PROJECT_NAME" || {
                echo "Error: Failed to remove existing $PROJECT_NAME directory"
                echo "Check directory permissions."
                exit 1
        }
        echo "Removed existing $PROJECT_NAME directory"
    fi
  
    mkdir -p "$PROJECT_NAME" || {
            echo "Error: Failed to create $PROJECT_NAME directory"
            echo "Check permissions and available disk space."
            exit 1
    }
  
    if [ -f "$PROJECT_DIR/out/README.md" ]; then
        cp "$PROJECT_DIR/out/README.md" "$PROJECT_NAME/" || { 
                echo "Error: Failed to copy README.md to $PROJECT_NAME folder."
                echo "Check file permissions and available disk space."
                exit 1
        }
        echo "✓ README.md copied to $PROJECT_NAME root successfully."
  else
    echo "Warning: README.md not found at $PROJECT_DIR/out/README.md - skipping."
  fi
  
  if [ ! -d "linux-unpacked" ]; then
      echo "Error: linux-unpacked directory not found in current directory"
      echo "Current directory: $(pwd)"
      exit 1
  fi
  
  cp -r linux-unpacked "$PROJECT_NAME/" || { 
      echo "Error: Failed to copy linux-unpacked to $PROJECT_NAME folder."
      echo "Check directory permissions and available disk space."
      exit 1
  }
  echo "✓ linux-unpacked directory copied successfully."
  
    cd "$PROJECT_NAME" || {
            echo "Error: Failed to change directory to $PROJECT_NAME"
            exit 1
    }
  
        cat > "$PROJECT_NAME" << 'EOF'
#!/usr/bin/env bash

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# App name derived from launcher filename
APP_NAME="$(basename "$0")"

# Define the path to the executable
EXECUTABLE="$SCRIPT_DIR/linux-unpacked/edge-ai-demo-studio"

# Check if the executable exists
if [ ! -f "$EXECUTABLE" ]; then
                echo "Error: $APP_NAME executable not found at $EXECUTABLE"
                exit 1
fi

# Launch the application
echo "Starting $APP_NAME..."
exec "$EXECUTABLE" "$@"
EOF
  
  if [ ! -f "$PROJECT_NAME" ]; then
      echo "Error: Failed to create $PROJECT_NAME launcher script"
      exit 1
  fi
  
  chmod +x "$PROJECT_NAME" || { 
      echo "Error: Failed to make launcher script executable."
      echo "Check file permissions."
      exit 1
  }
  
  echo "✓ $PROJECT_NAME launcher script created successfully."
  
  cd .. || {
      echo "Error: Failed to change directory back to out/"
      exit 1
  }
  
    echo "Creating $PROJECT_NAME.zip..."
  
  if ! command -v zip >/dev/null 2>&1; then
      echo "Error: zip is not installed. Please install zip to continue."
      echo "On Ubuntu/Debian: sudo apt-get install zip"
      exit 1
  fi
  
    if [ -f "$PROJECT_NAME.zip" ]; then
        rm "$PROJECT_NAME.zip" || {
                echo "Error: Failed to remove existing $PROJECT_NAME.zip"
                echo "Check file permissions."
                exit 1
        }
        echo "Removed existing $PROJECT_NAME.zip"
    fi
  
    if [ ! -d "$PROJECT_NAME" ]; then
            echo "Error: $PROJECT_NAME directory not found. Cannot create zip file."
            exit 1
    fi
  
    zip -r "$PROJECT_NAME.zip" "$PROJECT_NAME"/ || { 
            echo "Error: Failed to create zip file."
            echo "Check available disk space and permissions."
            exit 1
    }
  
    if [ ! -f "$PROJECT_NAME.zip" ]; then
            echo "Error: $PROJECT_NAME.zip was not created successfully."
            exit 1
    fi
  
        ZIP_SIZE=$(stat -f%z "$PROJECT_NAME.zip" 2>/dev/null || stat -c%s "$PROJECT_NAME.zip" 2>/dev/null)
        if [ -z "$ZIP_SIZE" ] || [ "$ZIP_SIZE" -lt 1024 ]; then
            echo "Error: $PROJECT_NAME.zip appears to be empty or corrupted (size: $ZIP_SIZE bytes)."
            exit 1
    fi

        HUMAN_SIZE=$(numfmt --to=iec-i --suffix=B "$ZIP_SIZE" 2>/dev/null || echo "$ZIP_SIZE bytes")
        echo "✓ $PROJECT_NAME.zip created successfully ($HUMAN_SIZE)."
  
  cd - >/dev/null || {
      echo "Error: Failed to return to previous directory"
      exit 1
  }
}

setup_frontend_package() {
  echo "Building frontend application..."
  
  if [ ! -d "$FRONTEND_DIR" ]; then
    echo "Error: Frontend directory not found at $FRONTEND_DIR"
    exit 1
  fi
  
  cd "$FRONTEND_DIR" || {
      echo "Error: Failed to change directory to $FRONTEND_DIR"
      exit 1
  }
  
  if [ ! -f "./setup.sh" ]; then
      echo "Error: Frontend setup.sh script not found at $FRONTEND_DIR/setup.sh"
      exit 1
  fi
  
  chmod +x ./setup.sh || {
      echo "Error: Failed to make setup.sh executable"
      exit 1
  }
  
  ./setup.sh || { 
      echo "Error: Frontend setup failed."
      echo "Check the frontend setup.sh script for errors."
      exit 1
  }
  
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
  
  mkdir -p "$TEMP_DIR/frontend" || {
      echo "Error: Failed to create frontend directory at $TEMP_DIR/frontend"
      exit 1
  }
  
  rsync -av .next/standalone/ "$TEMP_DIR/frontend/" || { 
      echo "Error: Failed to copy standalone frontend build files to temp directory."
      echo "Source: $FRONTEND_DIR/.next/standalone/"
      echo "Destination: $TEMP_DIR/frontend/"
      exit 1
  }
  
  mkdir -p "$TEMP_DIR/frontend/.next/static" || {
      echo "Error: Failed to create .next/static directory at $TEMP_DIR/frontend/.next/static"
      exit 1
  }
  
  rsync -av .next/static/ "$TEMP_DIR/frontend/.next/static/" || { 
      echo "Error: Failed to copy static frontend build files to temp directory."
      echo "Source: $FRONTEND_DIR/.next/static/"
      echo "Destination: $TEMP_DIR/frontend/.next/static/"
      exit 1
  }

  # server.js serves public/ from beside itself; the standalone output holds only the traced part.
  rsync -av public/ "$TEMP_DIR/frontend/public/" || {
      echo "Error: Failed to copy public frontend files to temp directory."
      echo "Source: $FRONTEND_DIR/public/"
      echo "Destination: $TEMP_DIR/frontend/public/"
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
  
  if [ -d "$TEMP_DIR" ]; then
    echo "Temporary directory already exists at $TEMP_DIR. Cleaning up..."
    rm -rf "$TEMP_DIR" || {
        echo "Error: Failed to remove existing temporary directory at $TEMP_DIR"
        echo "Check directory permissions and ensure no processes are using files in this directory."
        exit 1
    }
    echo "Cleaned up existing temporary directory."
  fi
  
  mkdir -p "$TEMP_DIR" || {
      echo "Error: Failed to create temporary directory at $TEMP_DIR"
      echo "Check parent directory permissions and available disk space."
      exit 1
  }
  
  if [ ! -d "$TEMP_DIR" ]; then
      echo "Error: Temporary directory was not created successfully at $TEMP_DIR"
      exit 1
  fi
  
  echo "✓ Temporary directory created at $TEMP_DIR"
}

run_electron_package() {
  echo "Packaging Electron application..."
  
  if [ ! -d "$ELECTRON_DIR" ]; then
    echo "Error: Electron directory not found at $ELECTRON_DIR"
    exit 1
  fi
  
  cd "$ELECTRON_DIR" || {
      echo "Error: Failed to change directory to $ELECTRON_DIR"
      exit 1
  }
  
  if [ ! -f "package.json" ]; then
      echo "Error: package.json not found in Electron directory"
      exit 1
  fi

  echo "Running npm install..."
  npm install || { 
      echo "Error: Electron installation failed."
      echo "Check the npm output above for specific errors."
      exit 1
  }
  
  if [ ! -d "node_modules" ]; then
      echo "Error: node_modules not found in Electron directory"
      echo "Please run npm install in the Electron directory first."
      exit 1
  fi
  
  if ! grep -q '"build"' package.json; then
      echo "Error: build script not found in package.json"
      echo "Please ensure the Electron package.json has a build script defined."
      exit 1
  fi
  
  echo "Running npm run build..."
  npm run build || { 
      echo "Error: Electron packaging failed."
      echo "Check the npm output above for specific errors."
      exit 1
  }
  
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

# Drop the musl and Windows native binaries Next.js standalone tracing pulls into glibc Linux builds.
# Runs on the staged build/ so every electron-builder target (zip, AppImage) leaves them out.
prune_native_binaries() {
  local RESOURCES_DIR="$TEMP_DIR/frontend/node_modules"

  if [ ! -d "$RESOURCES_DIR" ]; then
    echo "Warning: Frontend node_modules not found at $RESOURCES_DIR — skipping binary pruning."
    return 0
  fi

  echo "Pruning unused platform-specific native binaries..."

  local DIRS_TO_REMOVE=(
    "$RESOURCES_DIR/@img/sharp-libvips-linuxmusl-x64"
    "$RESOURCES_DIR/@img/sharp-linuxmusl-x64"
    "$RESOURCES_DIR/@libsql/linux-x64-musl"
    "$RESOURCES_DIR/@img/sharp-win32-x64"
    "$RESOURCES_DIR/@img/sharp-libvips-win32-x64"
  )

  local TOTAL_SAVED=0
  for DIR in "${DIRS_TO_REMOVE[@]}"; do
    if [ -d "$DIR" ]; then
      DIR_SIZE=$(du -sb "$DIR" 2>/dev/null | awk '{print $1}' || echo 0)
      rm -rf "$DIR" || echo "Warning: Failed to remove $DIR"
      TOTAL_SAVED=$((TOTAL_SAVED + DIR_SIZE))
      echo "  Removed: $(basename "$(dirname "$DIR")")/$(basename "$DIR") ($(numfmt --to=iec-i --suffix=B "$DIR_SIZE" 2>/dev/null || echo "${DIR_SIZE} bytes"))"
    fi
  done

  HUMAN_SAVED=$(numfmt --to=iec-i --suffix=B "$TOTAL_SAVED" 2>/dev/null || echo "${TOTAL_SAVED} bytes")
  echo "✓ Binary pruning complete — freed approximately $HUMAN_SAVED."
}

main() {
    echo "============================================"
    echo "$PROJECT_NAME Packaging Script"
    echo "============================================"
  echo ""
  
  cd "$SCRIPT_DIR" || {
      echo "Error: Failed to change to script directory: $SCRIPT_DIR"
      exit 1
  }
  
  if [ ! -d "$PROJECT_DIR" ]; then
      echo "Error: Project directory not found at $PROJECT_DIR"
      exit 1
  fi
  
  echo "Project directory: $PROJECT_DIR"
  echo "Build directory: $TEMP_DIR"
  echo ""
  
  validate_system_requirements || exit 1
  echo ""

  echo "Setting up thirdparty dependencies..."
  if ! bash "$SCRIPT_DIR/setup_thirdparty.sh"; then
    echo "Error: Failed to set up thirdparty dependencies."
    exit 1
  fi
  
  create_temp_dir || exit 1
  setup_node_env || exit 1
  copy_workers || exit 1
  copy_scripts || exit 1
  copy_deployment_config || exit 1
  setup_frontend_package || exit 1
  prune_native_binaries || exit 1
  run_electron_package || exit 1
  finalize_package || exit 1
  
  echo ""
  echo "============================================"
  echo "✓ Packaging completed successfully!"
  echo "============================================"
  echo ""
  echo "Output location: $PROJECT_DIR/out"
    echo "Zip file: $PROJECT_DIR/out/$PROJECT_NAME.zip"
  echo ""
  
  if [ -f "$PROJECT_DIR/out/$PROJECT_NAME.zip" ]; then
      ZIP_SIZE=$(stat -f%z "$PROJECT_DIR/out/$PROJECT_NAME.zip" 2>/dev/null || stat -c%s "$PROJECT_DIR/out/$PROJECT_NAME.zip" 2>/dev/null)
      if [ -n "$ZIP_SIZE" ]; then
          HUMAN_SIZE=$(numfmt --to=iec-i --suffix=B "$ZIP_SIZE" 2>/dev/null || echo "$ZIP_SIZE bytes")
          echo "Package size: $HUMAN_SIZE"
      fi
  fi
}

main