#Requires -Version 5.1
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

<#
.SYNOPSIS
  Remove an installed kiosk desktop app and the data it wrote (Windows).

.DESCRIPTION
  The PowerShell counterpart of uninstall.sh — same flags. Runs the installer's
  own uninstaller (NSIS .exe or MSI, whichever registered itself), then reports
  what it left behind: the app data directory holds the terminal's database,
  captured documents and enrolled portraits, so it is kept unless --data says
  otherwise.

  Uninstalling a per-machine install needs an elevated prompt.

.EXAMPLE
  uninstall_win.bat --dry-run
  List what would be removed.

.EXAMPLE
  uninstall_win.bat --data --yes
  Remove the app and everything it wrote, without asking.
#>
# No param block: PowerShell's -File binder mangles a pass-through list like
# `--data --yes` into parameter names. $args takes every token literally.
$Arguments = $args

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$Data = $false; $Caches = $false; $KeepPackage = $false; $DryRun = $false; $Yes = $false

function Show-Usage {
    Write-Host @"
Usage: uninstall_win.bat [options]

Removes the installed kiosk app (.exe/.msi) and reports what it left behind.
The app data directory holds the terminal's own database, captured documents
and enrolled portraits, so it is kept unless --data says otherwise.

Options:
  --data           also remove the app data directories (database, documents,
                   face photos, webview cache)
  --caches         also remove the uv / huggingface / npm caches. These are
                   SHARED with every other project on the machine - only pass
                   this on a dedicated terminal
  --keep-package   leave the installed app alone, act on the data only
  --dry-run        print what would be removed, remove nothing
  -y, --yes        do not ask (uses the installer's silent uninstall)
  -h, --help       this help
"@
}

foreach ($arg in $Arguments) {
    switch -Regex ($arg) {
        '^-{1,2}data$' { $Data = $true }
        '^-{1,2}caches$' { $Caches = $true }
        '^-{1,2}keep-package$' { $KeepPackage = $true }
        '^-{1,2}dry-run$' { $DryRun = $true }
        '^(-y|-{1,2}yes)$' { $Yes = $true }
        '^(-h|-{1,2}help|/\?)$' { Show-Usage; exit 0 }
        default { Show-Usage; Stop-WithError "unknown option: $arg" }
    }
}

# The package identity lives in the shell's package.json (the identifier in its
# build config); the defaults are the fallback for a copy of this script that
# travels without the checkout.
$Product = 'Vertical Reference Solutions Blueprint'
$Identifier = 'com.verticalreferencesolutionsblueprint.desktop'
$Binary = 'kiosk-desktop'
$pkgJson = Join-Path $ElectronDir 'package.json'
if (Test-Path -LiteralPath $pkgJson) {
    $pkg = Get-Content -LiteralPath $pkgJson -Raw | ConvertFrom-Json
    if ($pkg.productName) { $Product = $pkg.productName }
    if ($pkg.name) { $Binary = $pkg.name }
}

# Data lives under the short 'vrsb' name (MAX_PATH); earlier builds used the
# full identifier.
$DataDirs = @(@(
    (Join-Path $env:APPDATA 'vrsb'),
    (Join-Path $env:APPDATA $Identifier),
    (Join-Path $env:LOCALAPPDATA 'vrsb'),
    (Join-Path $env:LOCALAPPDATA $Identifier)
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) })

function Get-PathSize([string]$Path) {
    try {
        $sum = (Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue |
            Measure-Object -Property Length -Sum).Sum
    } catch { $sum = 0 }
    if (-not $sum) { return '0 B' }
    foreach ($unit in 'B', 'KB', 'MB', 'GB', 'TB') {
        if ($sum -lt 1024 -or $unit -eq 'TB') { return ('{0:N1} {1}' -f $sum, $unit) }
        $sum = $sum / 1024
    }
}

# Remove-Item -Recurse on a path this script computed, so the guard is against
# a bad computation, not against the user.
function Remove-Target([string]$Path) {
    $roots = @($env:USERPROFILE, $env:APPDATA, $env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)}) |
        Where-Object { $_ }
    $full = [System.IO.Path]::GetFullPath($Path)
    $inside = $false
    foreach ($root in $roots) {
        $rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd('\')
        if ($full.StartsWith($rootFull + '\', [System.StringComparison]::OrdinalIgnoreCase)) { $inside = $true }
    }
    if (-not $inside) { Stop-WithError "refusing to remove a path outside the user and program directories: $full" }
    if (-not (Test-Path -LiteralPath $full)) { return }
    Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction Stop
    Write-Ok "removed $full"
}

function Get-InstalledEntries {
    $keys = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -and ($_.DisplayName -like "$Product*" -or $_.DisplayName -like "$Binary*") } |
        Select-Object DisplayName, DisplayVersion, UninstallString, QuietUninstallString, InstallLocation, PSChildName
}

function Invoke-Uninstaller($entry) {
    $command = if ($Yes -and $entry.QuietUninstallString) { $entry.QuietUninstallString } else { $entry.UninstallString }
    if (-not $command) { Stop-WithError "no uninstall command recorded for $($entry.DisplayName)" }

    # An MSI records /I (install); the removal verb is /X on the same product code.
    if ($command -match 'msiexec') {
        $code = $entry.PSChildName
        $msiArgs = @('/x', $code)
        if ($Yes) { $msiArgs += '/qn' } else { $msiArgs += '/qb' }
        Write-Info "msiexec.exe $($msiArgs -join ' ')"
        $proc = Start-Process -FilePath 'msiexec.exe' -ArgumentList $msiArgs -Wait -PassThru
    } else {
        $exe = $command
        $rest = ''
        if ($command -match '^\s*"([^"]+)"\s*(.*)$') { $exe = $Matches[1]; $rest = $Matches[2] }
        elseif ($command -match '^\s*(\S+\.exe)\s*(.*)$') { $exe = $Matches[1]; $rest = $Matches[2] }
        if ($Yes -and $rest -notmatch '/S') { $rest = ("$rest /S").Trim() }
        Write-Info "$exe $rest"
        $proc = if ($rest) {
            Start-Process -FilePath $exe -ArgumentList $rest -Wait -PassThru
        } else {
            Start-Process -FilePath $exe -Wait -PassThru
        }
    }
    if ($proc.ExitCode -ne 0) { Write-Warn "the uninstaller exited with $($proc.ExitCode)" }
}

function Get-RunningProcesses {
    $paths = @($DataDirs)
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $proc = $_
        $proc.Name -eq "$Binary.exe" -or
        ($proc.ExecutablePath -and ($paths | Where-Object {
            $proc.ExecutablePath.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase)
        }))
    }
}

Write-Info "Product: $Product ($Identifier)"

$entries = @()
if (-not $KeepPackage) {
    $entries = @(Get-InstalledEntries)
    if ($entries.Count -eq 0) { Write-Info 'No installed package found in the uninstall registry' }
}

$removals = @()
if ($Data) {
    $removals += $DataDirs
} elseif ($DataDirs.Count -gt 0) {
    foreach ($dir in $DataDirs) { Write-Warn "keeping $dir ($(Get-PathSize $dir)) - pass --data to remove it" }
}
if ($Caches) {
    $removals += @(@(
        (Join-Path $env:LOCALAPPDATA 'uv\cache'),
        (Join-Path $env:USERPROFILE '.cache\huggingface'),
        (Join-Path $env:APPDATA 'npm-cache')
    ) | Where-Object { Test-Path -LiteralPath $_ })
}

if ($entries.Count -eq 0 -and $removals.Count -eq 0) {
    Write-Ok 'nothing to remove'
    exit 0
}

Write-Host ''
Write-Info 'To be removed:'
foreach ($entry in $entries) {
    Write-Host ("  package  {0} {1}" -f $entry.DisplayName, $entry.DisplayVersion)
}
foreach ($target in $removals) {
    Write-Host ("  {0,-10} {1}" -f (Get-PathSize $target), $target)
}
if ($Data -and $DataDirs.Count -gt 0) {
    Write-Warn 'the data directory holds the kiosk database, captured documents and enrolled portraits - they are not recoverable'
}
if ($Caches) {
    Write-Warn 'the uv/huggingface/npm caches are shared with every other project on this machine'
}
Write-Host ''

if ($DryRun) {
    Write-Info '--dry-run: nothing was removed'
    exit 0
}

if (-not $Yes) {
    if ([Console]::IsInputRedirected) { Stop-WithError 'not a terminal - re-run with --yes to confirm non-interactively' }
    $reply = Read-Host 'Proceed? [y/N]'
    if ($reply -notmatch '^(y|yes)$') { Stop-WithError 'aborted' }
}

$running = @(Get-RunningProcesses)
if ($running.Count -gt 0) {
    Write-Info "Stopping the running kiosk ($(($running | ForEach-Object { $_.ProcessId }) -join ' '))"
    foreach ($proc in $running) {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}

foreach ($entry in $entries) {
    Write-Info "Running the uninstaller for $($entry.DisplayName)"
    Invoke-Uninstaller $entry
}

foreach ($target in $removals) {
    Remove-Target $target
}

Write-Host ''
Write-Ok 'done'
if (-not $Data -and $DataDirs.Count -gt 0) {
    Write-Info "Data kept at $($DataDirs -join ', ')"
}
if (-not $Caches) {
    Write-Info 'Package caches were left alone: %LOCALAPPDATA%\uv\cache, %USERPROFILE%\.cache\huggingface, %APPDATA%\npm-cache'
}
$buildDir = Join-Path $RepoRoot 'build'
if (Test-Path -LiteralPath $buildDir) {
    Write-Info "Build output in $buildDir is untouched - remove it by hand if you no longer need it"
}
