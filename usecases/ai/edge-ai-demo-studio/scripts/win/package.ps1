# Copyright (C) 2025 Intel Corporation
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
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$NODE_PATH = Join-Path $PROJECT_ROOT "thirdparty/node"

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

function Add-WorkerFiles {
    # Copy worker files to the temporary directory
    Write-Host "Copying worker files to temporary directory..." -ForegroundColor Green
    try {
        if (-not (Test-Path $WORKER_DIR)) {
            throw "Worker directory not found at $WORKER_DIR"
        }
        New-Item -ItemType Directory -Path "$TEMP_DIR/workers" -ErrorAction Stop | Out-Null
        $robocopyResult = robocopy $WORKER_DIR "$TEMP_DIR/workers" /E /XD ".venv" "thirdparty" "__pycache__" "models" "avatars"
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
        $SCRIPTS_ROOT = Split-Path $SCRIPT_DIR -Parent
        
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
        npm run build:dir
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
    
    # Create the new EdgeAIDemoStudio package structure
    Write-Host "Creating EdgeAIDemoStudio package structure..." -ForegroundColor Green
    $outDir = Join-Path $PROJECT_ROOT "out"
    Push-Location $outDir
    
    try {
        # Remove existing EdgeAIDemoStudio directory if it exists
        if (Test-Path "EdgeAIDemoStudio") {
            Remove-Item -Recurse -Force "EdgeAIDemoStudio"
            Write-Host "Removed existing EdgeAIDemoStudio directory" -ForegroundColor Green
        }
        
        # Create EdgeAIDemoStudio directory
        New-Item -ItemType Directory -Path "EdgeAIDemoStudio" | Out-Null
        
        # Copy files to EdgeAIDemoStudio root
        $rootFiles = @("README.md", "start_web.bat", "setup.bat")
        foreach ($rootFile in $rootFiles) {
            $sourcePath = Join-Path $outDir $rootFile
            if (Test-Path $sourcePath) {
                Copy-Item $sourcePath "EdgeAIDemoStudio/" -Force
                Write-Host "$rootFile copied to EdgeAIDemoStudio root successfully." -ForegroundColor Green
            }
        }
        
        # Copy the entire win-unpacked directory into EdgeAIDemoStudio
        if (Test-Path "win-unpacked") {
            Copy-Item -Recurse "win-unpacked" "EdgeAIDemoStudio/" -Force
            Write-Host "win-unpacked directory copied successfully." -ForegroundColor Green
        }
        
        # Create a batch file launcher that launches the application correctly
        Push-Location "EdgeAIDemoStudio"
        $launcherContent = @'
@echo off
setlocal

rem Get the directory where this script is located
set "SCRIPT_DIR=%~dp0"

rem Define the path to the executable
set "EXECUTABLE=%SCRIPT_DIR%win-unpacked\EdgeAIDemoStudio.exe"

rem Check if the executable exists
if not exist "%EXECUTABLE%" (
    echo Error: EdgeAIDemoStudio executable not found at %EXECUTABLE%
    pause
    exit /b 1
)

rem Launch the application
echo Starting EdgeAIDemoStudio...
start "" "%EXECUTABLE%" %*
'@
        
        $launcherContent | Out-File -FilePath "EdgeAIDemoStudio.bat" -Encoding ASCII
        Write-Host "EdgeAIDemoStudio.bat launcher script created successfully." -ForegroundColor Green
        Pop-Location
        
        # Create zip file with the new structure
        Write-Host "Creating EdgeAIDemoStudio.zip..." -ForegroundColor Green
        if (Test-Path "EdgeAIDemoStudio.zip") {
            Remove-Item "EdgeAIDemoStudio.zip" -Force
            Write-Host "Removed existing EdgeAIDemoStudio.zip" -ForegroundColor Green
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

        Normalize-Timestamps -RootPath "EdgeAIDemoStudio"

        # Use PowerShell's Compress-Archive cmdlet
        Compress-Archive -Path "EdgeAIDemoStudio" -DestinationPath "EdgeAIDemoStudio.zip" -Force
        Write-Host "EdgeAIDemoStudio.zip created successfully." -ForegroundColor Green
        
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
    Write-Host "Zip file created: $outPath\EdgeAIDemoStudio.zip" -ForegroundColor Green
} catch {
    Write-Host "An error occurred: $_" -ForegroundColor Red
    exit 1
} finally {
    # Clean up Node.js PATH if it was modified
    Remove-NodeFromPath
    Pop-Location
}
