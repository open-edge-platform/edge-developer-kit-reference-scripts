# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
# Exit immediately if a command fails
$ErrorActionPreference = "Stop"

# Define variables
$SCRIPT_DIR = $PSScriptRoot
$PROJECT_ROOT = Split-Path (Split-Path $SCRIPT_DIR -Parent) -Parent
$TEMP_DIR = "$PROJECT_ROOT/build"
$WORKER_DIR = "$PROJECT_ROOT/workers"
$FRONTEND_DIR = "$PROJECT_ROOT/frontend"
$ELECTRON_DIR = "$PROJECT_ROOT/electron"
$NODE_PATH = Join-Path $PROJECT_ROOT "thirdparty/node"
$PROJECT_NAME = "EdgeAIDemoStudio"

function Add-NodeToPath {
    Write-Host "Setting up Node.js environment..." -ForegroundColor Green
    if (-not (Test-Path $NODE_PATH)) {
        Write-Host "Error: Node.js not found in $NODE_PATH. Please run setup.ps1 in the project root first." -ForegroundColor Red
        exit 1
    }
    if (-not $script:nodePathAdded) {
        $script:originalPath = $env:PATH
        $env:PATH = "$NODE_PATH;$env:PATH"
        $script:nodePathAdded = $true
        Write-Host "Temporarily added Node.js to PATH: $NODE_PATH" -ForegroundColor Green
        
        # Check for node and npm
        try {
            $nodeVersion = & node --version 2>$null
            $npmVersion = & npm --version 2>$null
            Write-Host "Node.js version: $nodeVersion" -ForegroundColor Green
            Write-Host "npm version: $npmVersion" -ForegroundColor Green
        } catch {
            Write-Host "Error: node or npm is not available in PATH." -ForegroundColor Red
            exit 1
        }
        return $true
    }
    return $false
}

function Remove-NodeFromPath {
    if ($script:nodePathAdded -and $script:originalPath) {
        Write-Host "Resetting environment variables..." -ForegroundColor Green
        $env:PATH = $script:originalPath
        $script:nodePathAdded = $false
        Write-Host "Restored original PATH" -ForegroundColor Green
    }
}

# Parse .gitignore files (root + under a source dir) and return two arrays suitable for robocopy:
#   DirPatterns  - safe directory exclusions for /XD
#   FilePatterns - safe file exclusions for /XF
# Patterns that robocopy cannot handle (character classes, wildcard-in-path) are skipped.
function Get-GitignoreExcludes {
    param(
        [Parameter(Mandatory=$true)] [string] $SrcDir
    )

    $dirExcludes  = [System.Collections.Generic.List[string]]::new()
    $fileExcludes = [System.Collections.Generic.List[string]]::new()

    # Classifies one gitignore line and appends it to the appropriate list.
    # Runs in the caller's child scope; modifies $dirExcludes / $fileExcludes via .Add() on the
    # shared List objects (reference semantics - no scope issue).
    $processLine = {
        param([string]$RawLine, [string]$Prefix, [string]$BaseDir)

        $line = $RawLine.Trim()
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#') -or $line.StartsWith('!')) { return }
        $line = ($line -replace '^[./]+', '') -replace '/$', ''
        $line = $line -replace '/', '\'
        if ($Prefix -ne '') { $line = "$Prefix\$line" }
        if ([string]::IsNullOrWhiteSpace($line)) { return }

        # Skip patterns with character classes like [oc] - not supported by robocopy.
        if ($line -match '\[') { return }

        $parts = $line -split '\\'
        $leaf  = $parts[-1]

        # Normalise trailing wildcards: ".venv\*" -> exclude dir ".venv"
        if ($leaf -eq '*') {
            $parts = @($parts[0..($parts.Length - 2)])
            if ($parts.Count -eq 0) { return }
            $line = $parts -join '\'
            $leaf = $parts[-1]
        }

        # Decide: file pattern vs directory/plain-name pattern.
        # File patterns: leaf looks like "*.ext" or "name.ext"
        # Hidden-dir names like ".venv", ".cache" are NOT file patterns (start with dot, no second dot).
        $isFilePat = $leaf -match '^\*\.' -or ($leaf -match '\.' -and $leaf -notmatch '^\.[-\w]+$')

        if ($isFilePat) {
            if ($parts.Count -eq 1) {
                # Simple wildcard extension, e.g. *.log - safe for /XF.
                # Also add to /XD so that directories named e.g. "*.egg-info" are covered.
                $fileExcludes.Add($line)
                $dirExcludes.Add($line)
            } else {
                # Path-specific file; resolve to absolute path for /XF.
                $absPath = Join-Path $BaseDir $line
                if (Test-Path $absPath -PathType Leaf) { $fileExcludes.Add($absPath) }
            }
        } else {
            if ($parts.Count -eq 1) {
                # Simple name like __pycache__ or .venv - matches any dir with that name in the tree.
                $dirExcludes.Add($line)
            } else {
                # Multi-level path - convert to absolute path for precise /XD matching.
                $absPath = Join-Path $BaseDir $line
                $dirExcludes.Add($absPath)
            }
        }
    }

    # Root .gitignore
    $rootIgnore = Join-Path $PROJECT_ROOT ".gitignore"
    if (Test-Path $rootIgnore) {
        Get-Content $rootIgnore | ForEach-Object { & $processLine $_ '' $PROJECT_ROOT }
    }

    # Per-directory .gitignore files under SrcDir
    if (Test-Path $SrcDir) {
        Get-ChildItem -Path $SrcDir -Filter .gitignore -Recurse -File | ForEach-Object {
            $ig    = $_.FullName
            $igDir = Split-Path $ig -Parent
            $prefix = if ($igDir -eq $SrcDir) { '' } else { $igDir.Substring($SrcDir.Length + 1).Replace('/', '\') }
            Get-Content $ig | ForEach-Object { & $processLine $_ $prefix $SrcDir }
        }
    }

    # Hard-coded defaults - simple dir names, safe for /XD
    '.venv', 'thirdparty', '__pycache__', 'models', 'avatars' | ForEach-Object { $dirExcludes.Add($_) }

    return @{
        DirPatterns  = $dirExcludes.ToArray()
        FilePatterns = $fileExcludes.ToArray()
    }
}

function Add-TempDir {
    # Create a temporary directory for worker files
    try {
        if (Test-Path $TEMP_DIR) {
            Write-Host "Temporary directory already exists. Cleaning up..." -ForegroundColor Yellow
            Remove-Item -Recurse -Force $TEMP_DIR -ErrorAction Stop
        } else {
            Write-Host "Temporary directory does not exist. Creating..." -ForegroundColor Green
        }
        New-Item -ItemType Directory -Path $TEMP_DIR -ErrorAction Stop | Out-Null
        Write-Host "Temporary directory created at $TEMP_DIR" -ForegroundColor Green
    } catch {
        Write-Host "Error creating temporary directory: $_" -ForegroundColor Red
        throw
    }
}

function Remove-TempDir {
    # Clean up the temporary directory
    try {
        if (Test-Path $TEMP_DIR) {
            Write-Host "Cleaning up temporary directory..." -ForegroundColor Green
            Remove-Item -Recurse -Force $TEMP_DIR -ErrorAction Stop
            Write-Host "Temporary directory removed." -ForegroundColor Green
        } else {
            Write-Host "Temporary directory not found. No cleanup needed." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "Error removing temporary directory: $_" -ForegroundColor Red
        throw
    }
}

function Add-WorkerFiles {
    # Copy worker files to the temporary directory
    Write-Host "Copying worker files to temporary directory..." -ForegroundColor Green
    try {
        if (-not (Test-Path $WORKER_DIR)) {
            throw "Worker directory not found at $WORKER_DIR"
        }
        New-Item -ItemType Directory -Path "$TEMP_DIR/workers" -ErrorAction Stop | Out-Null

        # Build excludes from .gitignore (root + per-worker), split into dir vs file patterns
        $excludes = Get-GitignoreExcludes -SrcDir $WORKER_DIR
        $robocopyArgs = [System.Collections.Generic.List[string]]::new()
        $robocopyArgs.Add($WORKER_DIR)
        $robocopyArgs.Add("$TEMP_DIR/workers")
        $robocopyArgs.Add('/E')
        if ($excludes.DirPatterns.Count -gt 0) {
            $robocopyArgs.Add('/XD')
            $excludes.DirPatterns | ForEach-Object { $robocopyArgs.Add($_) }
        }
        if ($excludes.FilePatterns.Count -gt 0) {
            $robocopyArgs.Add('/XF')
            $excludes.FilePatterns | ForEach-Object { $robocopyArgs.Add($_) }
        }

        Write-Host "Running robocopy (dir excludes: $($excludes.DirPatterns.Count), file excludes: $($excludes.FilePatterns.Count))..." -ForegroundColor Cyan
        $robocopyResult = & robocopy @robocopyArgs
        # Robocopy exit codes: 0-7 are success, 8+ are errors
        if ($LASTEXITCODE -lt 8) {
            Write-Host "Worker files copied successfully." -ForegroundColor Green
        } else {
            throw "Failed to copy worker files. Robocopy exit code: $LASTEXITCODE"
        }
    } catch {
        Write-Host "Error copying worker files: $_" -ForegroundColor Red
        throw
    }
}

function Add-ScriptFiles {
    Write-Host "Copying scripts to temporary directory..." -ForegroundColor Green
    
    try {
        # Get the scripts root directory (parent of win folder)
        $SCRIPTS_ROOT = $SCRIPT_DIR
        
        if (-not (Test-Path $SCRIPTS_ROOT)) {
            throw "Scripts root directory not found at $SCRIPTS_ROOT"
        }
        
        # Get all .ps1 files in the scripts directory recursively, except this script
        $ps1Files = Get-ChildItem -Path $SCRIPTS_ROOT -Filter *.ps1 -Recurse -File -ErrorAction Stop | Where-Object { $_.Name -ne "package.ps1" }
        if ($ps1Files) {
            foreach ($file in $ps1Files) {
                try {
                    # Calculate relative path from scripts root
                    $relativePath = $file.FullName.Substring($SCRIPTS_ROOT.Length + 1)
                    $destinationPath = Join-Path "$TEMP_DIR/scripts" $relativePath
                    $destinationDir = Split-Path $destinationPath -Parent
                    
                    # Create destination directory if it doesn't exist
                    if (-not (Test-Path $destinationDir)) {
                        New-Item -ItemType Directory -Path $destinationDir -Force -ErrorAction Stop | Out-Null
                    }
                    
                    # Copy the file preserving directory structure
                    Copy-Item $file.FullName $destinationPath -Force -ErrorAction Stop
                    Write-Host "  Copied: $relativePath" -ForegroundColor Gray
                } catch {
                    Write-Host "  Warning: Failed to copy $($file.Name): $_" -ForegroundColor Yellow
                }
            }
            Write-Host "Scripts copied successfully with original directory structure." -ForegroundColor Green
        } else {
            Write-Host "No .ps1 files found in $SCRIPTS_ROOT." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "Error copying script files: $_" -ForegroundColor Red
        throw
    }
}

function Invoke-FrontendBuild {
    # Build the frontend application
    Write-Host "Building frontend application..." -ForegroundColor Green
    
    if (-not (Test-Path $FRONTEND_DIR)) {
        Write-Host "Error: Frontend directory not found at $FRONTEND_DIR" -ForegroundColor Red
        throw "Frontend directory not found"
    }
    
    Push-Location $FRONTEND_DIR
    try {
        # Check if setup.ps1 exists
        if (-not (Test-Path "./setup.ps1")) {
            throw "setup.ps1 not found in frontend directory"
        }
        
        Write-Host "Running frontend setup and build..." -ForegroundColor Cyan
        & ./setup.ps1
        if ($LASTEXITCODE -ne 0) {
            throw "Frontend setup script failed with exit code $LASTEXITCODE"
        }
        
        # Create frontend directory structure
        Write-Host "Creating frontend build directory structure..." -ForegroundColor Cyan
        New-Item -ItemType Directory -Path "$TEMP_DIR/frontend" -Force -ErrorAction Stop | Out-Null
        New-Item -ItemType Directory -Path "$TEMP_DIR/frontend/.next" -Force -ErrorAction Stop | Out-Null
        
        # Verify build output exists
        if (-not (Test-Path ".next")) {
            throw "Frontend build output (.next directory) not found. Build may have failed."
        }
        
        # Copy standalone and static files
        $standalonePath = ".next/standalone"
        $staticPath = ".next/static"
        
        if (Test-Path $standalonePath) {
            Write-Host "Copying standalone frontend build files..." -ForegroundColor Cyan
            Copy-Item -Recurse "$standalonePath/*" "$TEMP_DIR/frontend/" -Force -ErrorAction Stop
            Write-Host "Standalone frontend build files copied successfully." -ForegroundColor Green
        } else {
            Write-Host "Warning: Standalone build output not found at $standalonePath" -ForegroundColor Yellow
        }
        
        if (Test-Path $staticPath) {
            Write-Host "Copying static frontend build files..." -ForegroundColor Cyan
            Copy-Item -Recurse $staticPath "$TEMP_DIR/frontend/.next/static" -Force -ErrorAction Stop
            Write-Host "Static frontend build files copied successfully." -ForegroundColor Green
        } else {
            Write-Host "Warning: Static build output not found at $staticPath" -ForegroundColor Yellow
        }
        
        # Verify at least some files were copied
        $frontendFiles = Get-ChildItem -Path "$TEMP_DIR/frontend" -Recurse -File
        if ($frontendFiles.Count -eq 0) {
            throw "No frontend files were copied to build directory"
        }
        Write-Host "Frontend build completed successfully. Total files: $($frontendFiles.Count)" -ForegroundColor Green
        
    } catch {
        Write-Host "Frontend build failed: $_" -ForegroundColor Red
        Write-Host "Stack trace: $($_.ScriptStackTrace)" -ForegroundColor Red
        throw
    } finally {
        Pop-Location
    }
}

function Start-ElectronPackage {
    # Package the Electron application
    Write-Host "Packaging Electron application..." -ForegroundColor Green
    
    if (-not (Test-Path $ELECTRON_DIR)) {
        Write-Host "Error: Electron directory not found at $ELECTRON_DIR" -ForegroundColor Red
        throw "Electron directory not found"
    }
    
    Push-Location $ELECTRON_DIR
    try {
        # Check if package.json exists
        if (-not (Test-Path "package.json")) {
            throw "package.json not found in Electron directory"
        }
        
        Write-Host "Installing Electron dependencies..." -ForegroundColor Cyan
        npm install
        if ($LASTEXITCODE -ne 0) {
            throw "npm install failed with exit code $LASTEXITCODE"
        }
        Write-Host "Electron dependencies installed successfully." -ForegroundColor Green
        
        Write-Host "Building Electron package..." -ForegroundColor Cyan
        npm run build:win
        if ($LASTEXITCODE -ne 0) {
            throw "Electron build failed with exit code $LASTEXITCODE"
        }
        Write-Host "Electron package built successfully." -ForegroundColor Green
        
    } catch {
        Write-Host "Electron packaging failed: $_" -ForegroundColor Red
        Write-Host "Stack trace: $($_.ScriptStackTrace)" -ForegroundColor Red
        throw
    } finally {
        Pop-Location
    }
}

function Invoke-FinalizePackage {
    # Copy distribution files to the final output directory and create zip
    Write-Host "Finalizing package..." -ForegroundColor Green
    
    # Determine the output folder name (Windows build)
    $OUT_FOLDER = Join-Path $PROJECT_ROOT "out/win-unpacked"
    
    if (-not (Test-Path $OUT_FOLDER)) {
        Write-Host "Error: Output folder not found at $OUT_FOLDER" -ForegroundColor Red
        exit 1
    }
    
    # Create the new package structure using project name
    Write-Host "Creating $PROJECT_NAME package structure..." -ForegroundColor Green
    $outDir = Join-Path $PROJECT_ROOT "out"
    Push-Location $outDir
    
    try {
        # Remove existing project directory if it exists
        if (Test-Path $PROJECT_NAME) {
            Remove-Item -Recurse -Force $PROJECT_NAME
            Write-Host "Removed existing $PROJECT_NAME directory" -ForegroundColor Green
        }

        # Move the win-unpacked folder to the project name. If move fails,
        # fall back to copying the contents into a newly created project folder.
        if (Test-Path $OUT_FOLDER) {
            try {
                Move-Item -LiteralPath $OUT_FOLDER -Destination (Join-Path $outDir $PROJECT_NAME) -Force
                Write-Host "Renamed win-unpacked to $PROJECT_NAME." -ForegroundColor Green
            } catch {
                Write-Host "Warning: failed to rename win-unpacked - falling back to copying contents: $_" -ForegroundColor Yellow
                New-Item -ItemType Directory -Path $PROJECT_NAME | Out-Null
                Copy-Item -Recurse (Join-Path $OUT_FOLDER '*') $PROJECT_NAME -Force
                Write-Host "win-unpacked contents copied into $PROJECT_NAME." -ForegroundColor Green
            }
        } else {
            Write-Host "Error: Output folder not found at $OUT_FOLDER" -ForegroundColor Red
            exit 1
        }
        
        # Create zip file with the new structure
        Write-Host "Creating $PROJECT_NAME.zip..." -ForegroundColor Green
        if (Test-Path "$PROJECT_NAME.zip") {
            Remove-Item "$PROJECT_NAME.zip" -Force
            Write-Host "Removed existing $PROJECT_NAME.zip" -ForegroundColor Green
        }

        # Normalize file timestamps to a DOS/ZIP-compatible range to avoid
        # "DateTimeOffset specified cannot be converted into a Zip file timestamp" errors.
        function Normalize-Timestamps {
            param(
                [Parameter(Mandatory=$true)]
                [string]$RootPath
            )

            # ZIP/DOS timestamp earliest supported date (approx) is 1980-01-01.
            $minDate = Get-Date "1980-01-02"

            Get-ChildItem -Path $RootPath -Recurse -Force | ForEach-Object {
                try {
                    if ($_.PSIsContainer) {
                        if ($_.LastWriteTime -lt $minDate) { $_.LastWriteTime = $minDate }
                    } else {
                        if ($_.LastWriteTime -lt $minDate) { $_.LastWriteTime = $minDate }
                    }
                } catch {
                    # Ignore files we cannot update
                    Write-Host "Warning: could not normalize timestamp for $($_.FullName): $_" -ForegroundColor Yellow
                }
            }
        }

        Normalize-Timestamps -RootPath $PROJECT_NAME

        # Use PowerShell's Compress-Archive cmdlet
        Compress-Archive -Path $PROJECT_NAME -DestinationPath "$PROJECT_NAME.zip" -Force
        Write-Host "$PROJECT_NAME.zip created successfully." -ForegroundColor Green
        
    } catch {
        Write-Host "Error during package finalization: $_" -ForegroundColor Red
        exit 1
    } finally {
        Pop-Location
    }
}

try {
    Push-Location $SCRIPT_DIR
    Add-NodeToPath
    Add-TempDir
    Add-WorkerFiles
    Add-ScriptFiles
    Invoke-FrontendBuild
    Start-ElectronPackage
    Invoke-FinalizePackage

    # Check the size of the build folder
    Write-Host "Checking the size of the build folder..." -ForegroundColor Green
    try {
        $buildSize = (Get-ChildItem -Recurse $TEMP_DIR | Measure-Object -Property Length -Sum).Sum / 1MB
        Write-Host "Build folder size: $([math]::Round($buildSize, 2)) MB" -ForegroundColor Green
    } catch {
        Write-Host "Failed to calculate the build folder size." -ForegroundColor Yellow
    }

    # Final message
    $outPath = Join-Path $SCRIPT_DIR "../out"
    Write-Host "Packaging completed successfully. Files are available in $outPath" -ForegroundColor Green
    Write-Host "Zip file created: $outPath\$PROJECT_NAME.zip" -ForegroundColor Green
} catch {
    Write-Host "An error occurred: $_" -ForegroundColor Red
    exit 1
} finally {
    # Clean up Node.js PATH if it was modified
    Remove-TempDir
    Remove-NodeFromPath
    Pop-Location
}
