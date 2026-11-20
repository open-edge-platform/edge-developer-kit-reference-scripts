# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Checked downloads and install manifests for the third-party tools setup installs. Dot-source it.
# Mirrors scripts/bash/thirdparty_integrity.sh.
#
# Every download is checked against a SHA-256 pinned beside its URL in the setup script, never one
# fetched from the download's own server: whoever can change the file there can change its checksum
# too. Each install then gets a .install-manifest with the SHA-256 and size of its files, so a later
# setup replaces an install that is damaged or was changed, and a start reports one
# (verify_thirdparty.ps1).

# Windows PowerShell 5.1 may default to TLS 1.0, which GitHub refuses.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$InstallManifestName = '.install-manifest'

# An absolute path, for the .NET calls below: they resolve a relative one against the process's
# directory, not PowerShell's.
function Get-FullPath {
    param([string]$Path)
    return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
}

function Get-Sha256 {
    param([string]$Path)
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($stream)) -replace '-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
        $stream.Dispose()
    }
}

function Remove-PathIfPresent {
    param([string]$Path)
    if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Recurse -Force }
}

# Save-VerifiedDownload <url> <file> <sha256> -- download to <file>, which is deleted again unless its
# SHA-256 is <sha256>.
function Save-VerifiedDownload {
    param([string]$Url, [string]$OutFile, [string]$Sha256)
    $OutFile = Get-FullPath $OutFile
    # Windows PowerShell 5.1 redraws the progress bar per chunk, which makes downloads many times slower.
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -ErrorAction Stop
    $actual = Get-Sha256 $OutFile
    if ($actual -ne $Sha256.ToLowerInvariant()) {
        Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
        throw "Checksum mismatch for ${Url}: expected $Sha256, got $actual. The download was deleted and nothing was installed."
    }
}

# The manifest of the install at <path>: inside a directory, beside a single file.
function Get-InstallManifestPath {
    param([string]$Path)
    if (Test-Path -LiteralPath $Path -PathType Container) { return Join-Path $Path $InstallManifestName }
    return "$Path$InstallManifestName"
}

# Write-InstallManifest <path> <source> [<exclude>] -- record the SHA-256 and size of every file of the
# install at <path> (a directory or a single file) and <source>, what it was installed from. Files
# under an <exclude> directory (relative, with /) are left out: what runs installs packages there.
function Write-InstallManifest {
    param([string]$Path, [string]$Source, [string[]]$Exclude = @())
    $Path = Get-FullPath $Path
    $lines = [Collections.Generic.List[string]]::new()
    $lines.Add('# Written by setup, which checks the install against it. Do not edit.')
    $lines.Add("source $Source")
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        $file = Get-Item -LiteralPath $Path
        $lines.Add("$(Get-Sha256 $file.FullName) $($file.Length) $($file.Name)")
    } else {
        $prefix = $Path.TrimEnd('\') + '\'
        foreach ($file in Get-ChildItem -LiteralPath $Path -Recurse -File -Force) {
            $relative = $file.FullName.Substring($prefix.Length).Replace('\', '/')
            if ($relative -eq $InstallManifestName) { continue }
            if ($Exclude | Where-Object { $relative.StartsWith("$_/", [StringComparison]::OrdinalIgnoreCase) }) { continue }
            $lines.Add("$(Get-Sha256 $file.FullName) $($file.Length) $relative")
        }
    }
    [IO.File]::WriteAllText((Get-InstallManifestPath $Path), (($lines -join "`n") + "`n"))
}

# Test-InstallManifest <path> [<source>] [-Quick] -- what is wrong with the install at <path>, a line
# each; nothing when it is intact. Given <source>, an install from anything else is wrong too (another
# version). -Quick compares sizes only, fast enough for every start; setup compares SHA-256 as well.
function Test-InstallManifest {
    param([string]$Path, [string]$Source, [switch]$Quick)
    $Path = Get-FullPath $Path
    if (-not (Test-Path -LiteralPath $Path)) { return 'it is not installed' }
    $manifest = Get-InstallManifestPath $Path
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
        return 'it was installed before setup checked downloads (no install manifest)'
    }
    $lines = [IO.File]::ReadAllLines($manifest)
    if ($Source -and -not ($lines -contains "source $Source")) {
        return 'it was installed from another download (another version)'
    }
    $base = if (Test-Path -LiteralPath $Path -PathType Leaf) { Split-Path -Parent $Path } else { $Path }
    $problems = [Collections.Generic.List[string]]::new()
    foreach ($line in $lines) {
        if (-not $line -or $line.StartsWith('#') -or $line.StartsWith('source ')) { continue }
        $fields = $line -split ' ', 3
        if ($fields.Count -ne 3) {
            $problems.Add('its install manifest is damaged')
            break
        }
        $file = [IO.FileInfo]::new((Join-Path $base $fields[2]))
        if (-not $file.Exists) {
            $problems.Add("$($fields[2]) is missing")
        } elseif ($file.Length -ne [long]$fields[1] -or (-not $Quick -and (Get-Sha256 $file.FullName) -ne $fields[0])) {
            $problems.Add("$($fields[2]) changed")
        }
    }
    return $problems.ToArray()
}

# The first few of <problems>, on one line.
function Format-InstallProblems {
    param([string[]]$Problems)
    $shown = ($Problems | Select-Object -First 3) -join '; '
    if ($Problems.Count -gt 3) { $shown += "; and $($Problems.Count - 3) more" }
    return $shown
}

# Install-VerifiedArchive -- install the zip at -Url into -Destination, unless the install there is
# intact and from that zip. The zip must match -Sha256; it is extracted beside the current install (a
# zip holding one directory gives its contents), -AfterExtract { param($dir) } runs on the result, its
# manifest is written, and only then are the two swapped, so a failure at any step leaves the current
# install as it was. -Source names what it was installed from when that is more than the zip.
# Returns $true when it installed, $false when the install was already intact.
function Install-VerifiedArchive {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$Sha256,
        [Parameter(Mandatory = $true)][string]$Destination,
        [string[]]$Exclude = @(),
        [scriptblock]$AfterExtract,
        [string]$Source = $Sha256
    )
    $Destination = Get-FullPath $Destination
    if (Test-Path -LiteralPath $Destination) {
        $problems = @(Test-InstallManifest -Path $Destination -Source $Source)
        if ($problems.Count -eq 0) {
            Write-Host "$Label is already installed at $Destination and intact." -ForegroundColor Green
            return $false
        }
        Write-Host "Reinstalling ${Label}: $(Format-InstallProblems $problems)" -ForegroundColor Yellow
    }

    $parent = Split-Path -Parent $Destination
    $name = Split-Path -Leaf $Destination
    $archive = Join-Path $parent "$name.download.zip"
    $staging = Join-Path $parent "$name.new"
    $previous = Join-Path $parent "$name.old"
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    try {
        Write-Host "Downloading $Label from $Url ..."
        Save-VerifiedDownload -Url $Url -OutFile $archive -Sha256 $Sha256
        Write-Host "Checksum verified. Extracting $Label ..."
        Remove-PathIfPresent $staging
        Expand-Archive -LiteralPath $archive -DestinationPath $staging -Force -ErrorAction Stop
        Remove-Item -LiteralPath $archive -Force

        # A zip holding a single directory (node-v24.22.2-win-x64\): its contents are the install.
        $entries = @(Get-ChildItem -LiteralPath $staging -Force)
        if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) {
            $wrapper = "$staging.wrapper"
            Remove-PathIfPresent $wrapper
            Rename-Item -LiteralPath $staging -NewName (Split-Path -Leaf $wrapper)
            Move-Item -LiteralPath (Join-Path $wrapper $entries[0].Name) -Destination $staging
            Remove-Item -LiteralPath $wrapper -Recurse -Force
        }
        if ($AfterExtract) { $null = & $AfterExtract $staging }
        Write-InstallManifest -Path $staging -Source $Source -Exclude $Exclude

        # A rename fails as a whole while a program in the install runs; a delete would stop partway
        # and leave a broken install.
        Remove-PathIfPresent $previous
        if (Test-Path -LiteralPath $Destination) {
            Rename-Item -LiteralPath $Destination -NewName (Split-Path -Leaf $previous)
        }
        Rename-Item -LiteralPath $staging -NewName $name
    } catch {
        if (-not (Test-Path -LiteralPath $Destination) -and (Test-Path -LiteralPath $previous)) {
            Rename-Item -LiteralPath $previous -NewName $name -ErrorAction SilentlyContinue
        }
        Remove-Item -LiteralPath $archive, $staging -Recurse -Force -ErrorAction SilentlyContinue
        throw
    }
    Remove-Item -LiteralPath $previous -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "$Label installed at $Destination" -ForegroundColor Green
    return $true
}

# Install-VerifiedFile -- download the single file at -Url to -Destination unless the file there is
# intact and from that download. It must match -Sha256. Returns whether it installed.
function Install-VerifiedFile {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$Sha256,
        [Parameter(Mandatory = $true)][string]$Destination
    )
    $Destination = Get-FullPath $Destination
    if (Test-Path -LiteralPath $Destination -PathType Leaf) {
        $problems = @(Test-InstallManifest -Path $Destination -Source $Sha256)
        if ($problems.Count -eq 0) {
            Write-Host "$Label is already installed at $Destination and intact." -ForegroundColor Green
            return $false
        }
        Write-Host "Reinstalling ${Label}: $(Format-InstallProblems $problems)" -ForegroundColor Yellow
    }

    $download = "$Destination.download"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
    try {
        Write-Host "Downloading $Label from $Url ..."
        Save-VerifiedDownload -Url $Url -OutFile $download -Sha256 $Sha256
        Move-Item -LiteralPath $download -Destination $Destination -Force
        Write-InstallManifest -Path $Destination -Source $Sha256
    } catch {
        Remove-Item -LiteralPath $download -Force -ErrorAction SilentlyContinue
        throw
    }
    Write-Host "Checksum verified. $Label installed at $Destination" -ForegroundColor Green
    return $true
}
