# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
# Exit immediately if a command fails
$ErrorActionPreference = "Stop"

# Define variables
$TEMP_DIR = "../build"
$WORKER_DIR = "../workers"
$FRONTEND_DIR = "../frontend"
$ELECTRON_DIR = "../electron"
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$NODE_PATH = Join-Path $SCRIPT_DIR "../thirdparty/node"

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
    if (Test-Path $TEMP_DIR) {
        Write-Host "Temporary directory already exists. Cleaning up..."
        Remove-Item -Recurse -Force $TEMP_DIR
    } else {
        Write-Host "Temporary directory does not exist. Creating..."
    }
    New-Item -ItemType Directory -Path $TEMP_DIR | Out-Null
    Write-Host "Temporary directory created at $TEMP_DIR"
}

function Add-WorkerFiles {
    # Copy worker files to the temporary directory
    Write-Host "Copying worker files to temporary directory..."
    New-Item -ItemType Directory -Path "$TEMP_DIR/workers" | Out-Null
    $robocopyResult = robocopy $WORKER_DIR "$TEMP_DIR/workers" /E /XD ".venv" "thirdparty" "__pycache__" "models" "avatars"
    if ($robocopyResult -lt 8) {
        Write-Host "Worker files copied successfully."
    } else {
        Write-Host "Failed to copy worker files. Robocopy exit code: $robocopyResult"
        exit 1
    }
}

function Add-ScriptFiles {
    Write-Host "Copying scripts to temporary directory..." -ForegroundColor Green
    New-Item -ItemType Directory -Path "$TEMP_DIR/scripts" -Force | Out-Null
    
    # Get all .ps1 files in the script directory except this script
    $ps1Files = Get-ChildItem -Path $SCRIPT_DIR -Filter *.ps1 -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne "package.ps1" }
    if ($ps1Files) {
        foreach ($file in $ps1Files) {
            Copy-Item $file.FullName "$TEMP_DIR/scripts/" -Force
        }
        Write-Host "Scripts copied successfully." -ForegroundColor Green
    } else {
        Write-Host "No .ps1 files found in $SCRIPT_DIR." -ForegroundColor Yellow
    }
}

function Invoke-FrontendBuild {
    # Build the frontend application
    if (Test-Path $FRONTEND_DIR) {
        Write-Host "Building frontend application..." -ForegroundColor Green
        Push-Location $FRONTEND_DIR
        try {
            npm install
            npm run build
            # Create frontend directory structure
            New-Item -ItemType Directory -Path "$TEMP_DIR/frontend" -Force | Out-Null
            New-Item -ItemType Directory -Path "$TEMP_DIR/frontend/.next" -Force | Out-Null
            
            # Copy standalone and static files
            if (Test-Path ".next/standalone") {
                Copy-Item -Recurse ".next/standalone/*" "$TEMP_DIR/frontend/" -Force
                Write-Host "Standalone frontend build files copied successfully." -ForegroundColor Green
            }
            if (Test-Path ".next/static") {
                Copy-Item -Recurse ".next/static" "$TEMP_DIR/frontend/.next/static" -Force
                Write-Host "Static frontend build files copied successfully." -ForegroundColor Green
            }
        } catch {
            Write-Host "Frontend build failed: $_" -ForegroundColor Red
            exit 1
        } finally {
            Pop-Location
        }
    } else {
        Write-Host "Frontend directory not found. Exiting..." -ForegroundColor Red
        exit 1
    }
}

function Start-ElectronPackage {
    # Package the Electron application
    if (Test-Path $ELECTRON_DIR) {
        Write-Host "Packaging Electron application..." -ForegroundColor Green
        Push-Location $ELECTRON_DIR
        try {
            npm install
            npm run build:dir
        } catch {
            Write-Host "Electron packaging failed: $_" -ForegroundColor Red
            exit 1
        } finally {
            Pop-Location
        }
    } else {
        Write-Host "Electron directory not found. Exiting..." -ForegroundColor Red
        exit 1
    }
}

function Invoke-FinalizePackage {
    # Copy distribution files to the final output directory and create zip
    Write-Host "Finalizing package..." -ForegroundColor Green
    
    # Determine the output folder name (Windows build)
    $OUT_FOLDER = Join-Path $SCRIPT_DIR "../out/win-unpacked"
    
    if (-not (Test-Path $OUT_FOLDER)) {
        Write-Host "Error: Output folder not found at $OUT_FOLDER" -ForegroundColor Red
        exit 1
    }
    
    # Create the new EdgeAIDemoStudio package structure
    Write-Host "Creating EdgeAIDemoStudio package structure..." -ForegroundColor Green
    $outDir = Join-Path $SCRIPT_DIR "../out"
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
        $rootFiles = @("README.md", "install_dependencies.sh", "run_web.ps1", "setup.ps1")
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
    Write-Host "Zip file created: $outPath\EdgeAIStudio.zip" -ForegroundColor Green
} catch {
    Write-Host "An error occurred: $_" -ForegroundColor Red
    exit 1
} finally {
    # Clean up Node.js PATH if it was modified
    Remove-NodeFromPath
    Pop-Location
}
