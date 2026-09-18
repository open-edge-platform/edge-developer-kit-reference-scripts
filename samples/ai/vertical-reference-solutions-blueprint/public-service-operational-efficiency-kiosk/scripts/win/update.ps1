#Requires -Version 5.1
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

<#
.SYNOPSIS
  Mirror this checkout into another directory.

.DESCRIPTION
  The PowerShell counterpart of scripts/dev/update.sh — same flags. Run it
  through scripts\dev\update.bat.

.EXAMPLE
  scripts\dev\update.bat --dry-run D:\kiosk
  List what would be removed and copied, change nothing.
#>
# No param block: PowerShell's -File binder mangles a pass-through list.
# $args takes every token literally, the way "$@" does in the bash counterpart.
$Arguments = $args

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$Dry = $false; $Yes = $false; $All = $false; $Target = ''
$Keep = [System.Collections.Generic.List[string]]@('.git', '.claude')

function Show-Usage {
    Write-Host @"
Usage: scripts\dev\update.bat [options] <target-dir>

Replaces the contents of <target-dir> with this checkout. The file list is
everything git tracks plus everything untracked that .gitignore does not
exclude - so build output, node_modules, databases and local config never
travel. .git, .claude and the update scripts themselves are excluded from the
copy; .git and .claude are, by default, left alone in the target too.

The target is created if it does not exist. It may not be this checkout, or
contain it.

Options:
  --keep <name>  also keep this top-level entry in the target (repeatable)
  --all          empty the target completely, .git and .claude included
  --dry-run      print what would be removed and copied, change nothing
  -y, --yes      do not ask before emptying the target
  -h, --help     this help
"@
}

for ($i = 0; $i -lt $Arguments.Count; $i++) {
    $arg = [string]$Arguments[$i]
    switch -Regex ($arg) {
        '^-{1,2}keep$' {
            if ($i + 1 -ge $Arguments.Count) { Stop-WithError '--keep needs a name' }
            $i++; $Keep.Add([string]$Arguments[$i])
        }
        '^-{1,2}all$' { $All = $true }
        '^-{1,2}dry-run$' { $Dry = $true }
        '^(-y|--yes)$' { $Yes = $true }
        '^(-h|--help|-\?)$' { Show-Usage; exit 0 }
        default {
            # switch -Regex runs every matching branch, so the unknown-option
            # check lives here rather than in a '^-' branch of its own.
            if ($arg.StartsWith('-')) { Show-Usage; Stop-WithError "unknown option: $arg" }
            if ($Target -ne '') { Stop-WithError "one target directory at a time (got '$Target' and '$arg')" }
            $Target = $arg
        }
    }
}

if ($Target -eq '') { Show-Usage; Stop-WithError 'no target directory given' }
if ($All) { $Keep.Clear() }

# PowerShell 5.1 turns a native command's stderr into error records, which
# $ErrorActionPreference = 'Stop' then aborts on - so git runs with the
# preference relaxed and is judged by its exit code, like in the bash script.
function Invoke-Git {
    param([string[]]$GitArgs)
    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $git) { Stop-WithError 'git is not on PATH - the file list comes from git' }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $git.Source @GitArgs 2>$null
        $script:GitExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    return $output
}

$Source = (Resolve-Path -LiteralPath $RepoRoot).Path.TrimEnd('\')
Invoke-Git @('-C', $Source, 'rev-parse', '--git-dir') | Out-Null
if ($GitExitCode -ne 0) { Stop-WithError "$Source is not a git checkout - the file list comes from git" }

# Absolute and normalized without creating anything: the guards below have to
# run before the target exists, not after.
$Target = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine((Get-Location).Path, $Target)).TrimEnd('\')

# The target gets emptied, so a bad path here is unrecoverable.
$root = [System.IO.Path]::GetPathRoot($Target).TrimEnd('\')
if ($Target -eq $root -or $Target -eq $HOME.TrimEnd('\')) { Stop-WithError "refusing to empty $Target" }
if ($Target -eq $Source) { Stop-WithError 'the target is this checkout' }
if ($Target.StartsWith("$Source\", [StringComparison]::OrdinalIgnoreCase)) { Stop-WithError "the target is inside this checkout: $Target" }
if ($Source.StartsWith("$Target\", [StringComparison]::OrdinalIgnoreCase)) { Stop-WithError "the target contains this checkout: $Target" }

New-Item -ItemType Directory -Force -Path $Target | Out-Null

# Tracked plus untracked-but-not-ignored: what a clean clone of this working
# tree would hold. NUL-delimited, so odd filenames survive.
$listing = (Invoke-Git @(
    '-C', $Source, '-c', 'core.quotepath=false',
    'ls-files', '-z', '--cached', '--others', '--exclude-standard')) -join "`n"
if ($GitExitCode -ne 0) { Stop-WithError 'git ls-files failed' }
# The update tooling stays behind: it belongs to this checkout, not to the
# copy it makes. Both platforms' entry points, so the target comes out the
# same whichever one ran.
$self = @('scripts/dev/update.sh', 'scripts/dev/update.bat', 'scripts/win/update.ps1')
$files = @($listing -split "`0" | Where-Object {
    $_ -ne '' -and $_ -notmatch '^\.(git|claude)(/|$)' -and $self -notcontains $_
})
if ($files.Count -eq 0) { Stop-WithError 'git listed no files to copy' }

$remove = @(Get-ChildItem -LiteralPath $Target -Force |
    Where-Object { $Keep -notcontains $_.Name })

Write-Info "Source  $Source"
Write-Info "Target  $Target"
Write-Host "    copy    $($files.Count) files (git-tracked and untracked-not-ignored, minus .git, .claude and update.ps1)"
if ($remove.Count -eq 0) {
    Write-Host '    remove  nothing - the target is empty'
} else {
    Write-Host "    remove  $($remove.Count) entries from the target:"
    foreach ($entry in $remove) { Write-Host "              $($entry.Name)" }
}
if ($Keep.Count -gt 0) { Write-Host "    keep    $($Keep -join ' ')" }
Write-Host ''

if ($Dry) { Write-Info '--dry-run: nothing was removed or copied'; exit 0 }

if ($remove.Count -gt 0 -and -not $Yes) {
    if ([Console]::IsInputRedirected) { Stop-WithError 'not a terminal - re-run with --yes to confirm non-interactively' }
    Write-Warn "everything listed above is deleted from $Target and is not recoverable"
    $reply = Read-Host 'Proceed? [y/N]'
    if ($reply -notmatch '^(y|yes)$') { Stop-WithError 'aborted' }
}

foreach ($entry in $remove) {
    Remove-Item -LiteralPath $entry.FullName -Recurse -Force
}
if ($remove.Count -gt 0) { Write-Ok "emptied $Target" }

# Copy per file rather than a whole-tree copy: the list is explicit, and a
# missing source file (deleted after git listed it) stays a plain error.
foreach ($file in $files) {
    $relative = $file -replace '/', '\'
    $from = Join-Path $Source $relative
    if (-not (Test-Path -LiteralPath $from)) { Write-Warn "gone since git listed it, skipped: $file"; continue }
    $to = Join-Path $Target $relative
    $dir = Split-Path -Parent $to
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Copy-Item -LiteralPath $from -Destination $to -Force
}

Write-Ok "copied $($files.Count) files to $Target"
