# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Detect OS architecture and select the matching package
$OsArch = if ([System.Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
Write-Host "Detected OS architecture: $OsArch" -ForegroundColor Cyan

$AllPackages = @(
    @{ Arch = "x86"; Url = "https://aka.ms/vc14/vc_redist.x86.exe"; Filter = "Microsoft Visual C++ *Redistributable (x86)*" },
    @{ Arch = "x64"; Url = "https://aka.ms/vc14/vc_redist.x64.exe"; Filter = "Microsoft Visual C++ *Redistributable (x64)*" }
)

$Packages = $AllPackages | Where-Object { $_.Arch -eq $OsArch }

$RegPaths = @(
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
)

# 1. PRE-ELEVATION CHECK — runs without admin rights, avoids unnecessary UAC prompt
Write-Host "Scanning system registry for Microsoft Visual C++..." -ForegroundColor Cyan

$MissingPackages = @()
foreach ($pkg in $Packages) {
    $found = Get-ItemProperty $RegPaths -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like $pkg.Filter }
    if ($found) {
        Write-Host "[SUCCESS] Visual C++ ($($pkg.Arch)) is already installed. Version: $($found.DisplayVersion)" -ForegroundColor Green
    } else {
        Write-Host "[MISSING] Visual C++ ($($pkg.Arch)) is not installed." -ForegroundColor Yellow
        $MissingPackages += $pkg
    }
}

if ($MissingPackages.Count -eq 0) {
    Write-Host "All required Visual C++ Redistributable packages are installed. No action needed." -ForegroundColor Green
    Exit
}

# 2. AUTO-ELEVATION BLOCK (Triggers the UAC Prompt only when installation is needed)
$CurrentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = New-Object Security.Principal.WindowsPrincipal($CurrentIdentity)
$IsAdmin = $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $IsAdmin) {
    # If not running as Admin, relaunch this exact script, asking for Admin rights
    Write-Host "Requesting Administrator privileges..." -ForegroundColor Yellow

    try {
        # -Verb RunAs triggers the Windows UAC pop-up
        $elevated = Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs -Wait -PassThru
        exit $elevated.ExitCode
    } catch {
        Write-Host "[ERROR] Administrator elevation was cancelled or failed: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

# 3. MAIN INSTALLATION LOGIC (Runs only after user clicks "Yes" on the pop-up)
# Force TLS 1.2 (and TLS 1.3 when available) for secure download connections
$tls = [Net.SecurityProtocolType]::Tls12
if ([enum]::GetNames([Net.SecurityProtocolType]) -contains "Tls13") {
    $tls = $tls -bor [Net.SecurityProtocolType]::Tls13
}
[Net.ServicePointManager]::SecurityProtocol = $tls

$OverallSuccess = $true

foreach ($pkg in $MissingPackages) {
    $InstallerPath = "$env:TEMP\vc_redist.$($pkg.Arch).exe"
    Write-Host ""
    Write-Host "--- Installing Visual C++ ($($pkg.Arch)) ---" -ForegroundColor Cyan
    Write-Host "Installer Path: $InstallerPath"
    Write-Host "Downloading from: $($pkg.Url)" -ForegroundColor Yellow

    try {
        # Download the installer
        Invoke-WebRequest -Uri $pkg.Url -OutFile $InstallerPath -UseBasicParsing -ErrorAction Stop
        Write-Host "[DOWNLOAD COMPLETE] Installer saved to TEMP directory." -ForegroundColor Green

        # Run the installer silently
        Write-Host "Installing... please wait..." -ForegroundColor Yellow
        $Process = Start-Process -FilePath $InstallerPath -ArgumentList "/install", "/quiet", "/norestart" -Wait -PassThru

        if ($Process.ExitCode -eq 0 -or $Process.ExitCode -eq 3010) {
            Write-Host "[SUCCESS] Visual C++ ($($pkg.Arch)) installed successfully!" -ForegroundColor Green
            if ($Process.ExitCode -eq 3010) {
                Write-Host "[NOTE] A system reboot may be required later to finalize changes." -ForegroundColor Cyan
            }
        } else {
            Write-Host "[ERROR] Installation failed with Exit Code: $($Process.ExitCode)" -ForegroundColor Red
            $OverallSuccess = $false
        }

    } catch {
        Write-Host "[ERROR] Something went wrong during download or installation: $_" -ForegroundColor Red
        $OverallSuccess = $false
    } finally {
        # Clean up the installation file from the temporary directory
        if (Test-Path $InstallerPath) {
            Remove-Item $InstallerPath -Force
        }
    }
}

Write-Host ""
if ($OverallSuccess) {
    Write-Host "[DONE] All Visual C++ Redistributable packages installed successfully." -ForegroundColor Green
    exit 0
} else {
    Write-Host "[DONE] One or more packages failed to install. See errors above." -ForegroundColor Red
    exit 1
}
