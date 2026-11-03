# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Windows counterpart of oep-setup.sh: copies the upstream code listed in oep-services.json (keys
# in oep-services.schema.json) next to each worker, applies the entry's "patch" and
# <worker>\overlay\, and records the ref in a marker file.
#
# Usage:
#   .\oep-setup.ps1                  list catalogued services, sources, suite apps, custom workers
#   .\oep-setup.ps1 check            compare pins with the copies on disk
#   .\oep-setup.ps1 fetch <worker>   copy every entry of <worker> at its pin if needed, apply patch/overlay
#   .\oep-setup.ps1 fetch --all      the same for every catalogued worker
#   .\oep-setup.ps1 info <worker>    show what the entries of <worker> resolve to
#   .\oep-setup.ps1 tag              print the pinned edge-ai-libraries tag
#   .\oep-setup.ps1 pin <tag>        rewrite "tag" (the edge-ai-libraries pin) in oep-services.json

param(
    [ValidateSet("list", "check", "fetch", "info", "tag", "pin", "help")]
    [string]$Mode = "list",
    [string]$Target = ""
)

$ErrorActionPreference = "Stop"
$SCRIPT_DIR = $PSScriptRoot
$CATALOG_FILE = Join-Path $SCRIPT_DIR "oep-services.json"
# The one sparse clone every service's copy is made from.
$OEP_LIBRARIES_CACHE_DIR = Join-Path $SCRIPT_DIR "thirdparty\edge-ai-libraries"
# One sparse clone per plain git source lives under here.
$SOURCES_CACHE_ROOT = Join-Path $SCRIPT_DIR "thirdparty\git"
# Written into every copy with the ref it was made from.
$SERVICE_REF_FILE_NAME = ".demo-studio-edge-ai-libraries-ref"
$SOURCE_REF_FILE_NAME = ".demo-studio-source-ref"

# -- Catalogue (oep-services.json) -------------------------------------

function Read-Catalog {
    if (-not (Test-Path $CATALOG_FILE)) { throw "${CATALOG_FILE} not found" }
    $doc = Get-Content $CATALOG_FILE -Raw | ConvertFrom-Json
    if (-not $doc.tag) { throw "${CATALOG_FILE}: top-level `"tag`" is required" }
    $script:REPO_URL = if ($doc.repository) { $doc.repository } else { "https://github.com/open-edge-platform/edge-ai-libraries.git" }
    $script:PINNED_TAG = $doc.tag
    $script:RECORDS = @()
    $serviceKeys = @("worker", "subdir", "name", "sentinel", "dir", "home_env", "tag", "install")
    $sourceKeys = @("worker", "repository", "ref", "subdir", "name", "sentinel", "dir", "home_env", "patch", "patch_strip", "keep_root")
    $index = 0
    foreach ($svc in @($doc.services)) {
        $record = @{ kind = "service" }
        foreach ($prop in $svc.PSObject.Properties) {
            if ($serviceKeys -notcontains $prop.Name) { throw "${CATALOG_FILE}: services[$index] has unknown key '$($prop.Name)'" }
            $record[$prop.Name] = [string]$prop.Value
        }
        if (-not $record.worker -or -not $record.subdir) { throw "${CATALOG_FILE}: services[$index] needs `"worker`" and `"subdir`"" }
        $script:RECORDS += $record
        $index++
    }
    $index = 0
    foreach ($src in @($doc.sources)) {
        if ($null -eq $src) { continue }
        $record = @{ kind = "source" }
        foreach ($prop in $src.PSObject.Properties) {
            if ($sourceKeys -notcontains $prop.Name) { throw "${CATALOG_FILE}: sources[$index] has unknown key '$($prop.Name)'" }
            $record[$prop.Name] = if ($prop.Value -is [bool]) { $prop.Value.ToString().ToLower() } else { [string]$prop.Value }
        }
        foreach ($key in @("worker", "repository", "ref", "subdir")) {
            if (-not $record[$key]) { throw "${CATALOG_FILE}: sources[$index] needs `"$key`"" }
        }
        $script:RECORDS += $record
        $index++
    }
}

# Resolve one record into $script:OEP_* values (mirrors oep_load_record).
function Use-Record($record) {
    $script:OEP_KIND = $record.kind
    $script:OEP_WORKER = $record.worker.TrimEnd("/")
    $script:OEP_WORKER_DIR = Join-Path $SCRIPT_DIR ($script:OEP_WORKER -replace "/", "\")
    $script:OEP_SUBDIR = $record.subdir.TrimEnd("/")
    $script:OEP_NAME = if ($record.name) { $record.name } else { Split-Path $script:OEP_SUBDIR -Leaf }
    $script:OEP_SENTINEL_REL = if ($record.sentinel) { $record.sentinel -replace "/", "\" } else { "" }
    $script:OEP_HOME_ENV = $record.home_env
    $script:OEP_PATCH = $record.patch
    $script:OEP_PATCH_STRIP = if ($record.patch_strip) { [int]$record.patch_strip } else { 1 }
    $script:OEP_KEEP_ROOT = ($record.keep_root -eq "true")
    if ($script:OEP_KIND -eq "service") {
        $script:OEP_REPO_URL = $script:REPO_URL
        $script:OEP_TAG = if ($env:EDGE_AI_LIBRARIES_REF) { $env:EDGE_AI_LIBRARIES_REF.Trim() } elseif ($record.tag) { $record.tag } else { $script:PINNED_TAG }
        $script:OEP_CACHE_DIR = $OEP_LIBRARIES_CACHE_DIR
        $script:OEP_REF_FILE_NAME = $SERVICE_REF_FILE_NAME
        $script:OEP_LABEL = "OEP $($script:OEP_NAME)"
    } else {
        $script:OEP_REPO_URL = $record.repository
        $script:OEP_TAG = $record.ref
        $script:OEP_CACHE_DIR = Join-Path $SOURCES_CACHE_ROOT $script:OEP_NAME
        $script:OEP_REF_FILE_NAME = $SOURCE_REF_FILE_NAME
        $script:OEP_LABEL = "source $($script:OEP_NAME)"
    }

    # OEP_SRC_DIR is the flat copy the wrapper imports from (the catalogue's
    # "dir"), or the directory home_env points at.
    $script:OEP_EXTERNAL = $false
    $homeValue = if ($record.home_env) { [Environment]::GetEnvironmentVariable($record.home_env) } else { $null }
    if ($homeValue) {
        $script:OEP_SRC_DIR = $homeValue
        $script:OEP_EXTERNAL = $true
    } elseif ($record.dir) {
        $dir = $record.dir -replace "/", "\"
        $script:OEP_SRC_DIR = if ([System.IO.Path]::IsPathRooted($dir)) { $dir } else { Join-Path $script:OEP_WORKER_DIR $dir }
    } else {
        $script:OEP_SRC_DIR = Join-Path $script:OEP_WORKER_DIR "thirdparty\$($script:OEP_NAME)"
    }
    $script:OEP_SRC_DIR = [System.IO.Path]::GetFullPath($script:OEP_SRC_DIR)
    $script:OEP_SENTINEL = if ($script:OEP_SENTINEL_REL) { Join-Path $script:OEP_SRC_DIR $script:OEP_SENTINEL_REL } else { $script:OEP_SRC_DIR }
    $script:OEP_REF_FILE = Join-Path $script:OEP_SRC_DIR $script:OEP_REF_FILE_NAME
    $script:OEP_OVERLAY_DIR = Join-Path $script:OEP_WORKER_DIR "overlay"
    if (Test-Path (Join-Path $script:OEP_OVERLAY_DIR $script:OEP_NAME)) {
        # A worker with several entries keeps one overlay per entry.
        $script:OEP_OVERLAY_DIR = Join-Path $script:OEP_OVERLAY_DIR $script:OEP_NAME
    }
    $script:OEP_PATCH_FILE = if ($script:OEP_PATCH) { Join-Path $script:OEP_WORKER_DIR $script:OEP_PATCH } else { "" }
    $script:OEP_CACHE_APP_DIR = Join-Path $script:OEP_CACHE_DIR ($script:OEP_SUBDIR -replace "/", "\")
}

# Every record whose worker is $Name; throws when there is none.
function Get-WorkerRecords([string]$Name) {
    $wanted = $Name.TrimEnd("/", "\") -replace "\\", "/"
    $matches = @($script:RECORDS | Where-Object { $_.worker -eq $wanted })
    if ($matches.Count -eq 0) {
        $known = ($script:RECORDS | ForEach-Object { "$($_.worker) ($($_.kind))" }) -join ", "
        throw "'$wanted' is not in oep-services.json. Catalogued workers: $known"
    }
    return $matches
}

# Ref the copy was made from ("" when there is no copy or no marker).
function Get-CheckedOutTag {
    if (-not (Test-Path $script:OEP_REF_FILE)) { return "" }
    return (Get-Content $script:OEP_REF_FILE -Raw).Trim()
}

function Test-CommitRef { return ($script:OEP_TAG -match '^[0-9a-f]{40}$') }

# -- Cache -------------------------------------------------------------

function Test-Git {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw "git is required to fetch $($script:OEP_LABEL). Install Git for Windows (https://git-scm.com/download/win) and try again."
    }
}

# Bring the existing cache to OEP_TAG with OEP_SUBDIR materialised. Returns
# $false (rather than repairing) when the clone is unusable; the caller re-clones.
function Update-Cache {
    # Judge git by $LASTEXITCODE: under "Stop", Windows PowerShell 5.1 turns a git stderr line into
    # a terminating error.
    $ErrorActionPreference = "Continue"
    $cache = $script:OEP_CACHE_DIR
    & git -C $cache remote set-url origin $script:OEP_REPO_URL
    if ($LASTEXITCODE -ne 0) { return $false }
    if (Test-CommitRef) {
        & git -C $cache cat-file -e "$($script:OEP_TAG)^{commit}" 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Fetching $script:OEP_NAME $script:OEP_TAG into the cache..."
            & git -C $cache fetch --quiet --depth 1 origin $script:OEP_TAG
            if ($LASTEXITCODE -ne 0) { return $false }
        }
        $want = $script:OEP_TAG
    } else {
        & git -C $cache rev-parse -q --verify "refs/tags/$($script:OEP_TAG)^{commit}" 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Fetching $script:OEP_NAME $script:OEP_TAG into the cache..."
            & git -C $cache fetch --quiet --depth 1 origin "refs/tags/$($script:OEP_TAG):refs/tags/$($script:OEP_TAG)"
            if ($LASTEXITCODE -ne 0) { return $false }
        }
        $want = "refs/tags/$($script:OEP_TAG)"
    }
    $head = (& git -C $cache rev-parse HEAD | Out-String).Trim()
    $target = (& git -C $cache rev-parse "$want^{commit}" | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { return $false }
    if ($head -ne $target) {
        & git -C $cache -c advice.detachedHead=false checkout --quiet --detach $want
        if ($LASTEXITCODE -ne 0) { return $false }
    }
    # Idempotent; grows the sparse checkout by this entry's directory.
    & git -C $cache sparse-checkout add $script:OEP_SUBDIR | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function New-Cache {
    $ErrorActionPreference = "Continue"
    $cache = $script:OEP_CACHE_DIR
    New-Item -ItemType Directory -Force -Path (Split-Path $cache -Parent) | Out-Null
    Write-Host "Cloning $script:OEP_REPO_URL ($script:OEP_TAG) into the cache $cache..."
    if (Test-CommitRef) {
        # A commit cannot be cloned with --branch: clone nothing, then fetch it.
        & git clone --quiet --no-checkout --filter=blob:none --sparse $script:OEP_REPO_URL $cache
        if ($LASTEXITCODE -eq 0) { & git -C $cache fetch --quiet --depth 1 origin $script:OEP_TAG }
        if ($LASTEXITCODE -eq 0) { & git -C $cache sparse-checkout set $script:OEP_SUBDIR | Out-Null }
        if ($LASTEXITCODE -eq 0) { & git -C $cache -c advice.detachedHead=false checkout --quiet --detach $script:OEP_TAG }
    } else {
        & git -c advice.detachedHead=false clone --quiet --depth 1 --branch $script:OEP_TAG --filter=blob:none --sparse $script:OEP_REPO_URL $cache
        if ($LASTEXITCODE -eq 0) { & git -C $cache sparse-checkout set $script:OEP_SUBDIR | Out-Null }
    }
    if ($LASTEXITCODE -ne 0) {
        Remove-Item -Recurse -Force $cache -ErrorAction SilentlyContinue
        throw "Failed to clone $script:OEP_REPO_URL at $script:OEP_TAG"
    }
}

# Make sure the cache holds OEP_SUBDIR at OEP_TAG.
function Ensure-Cache {
    Test-Git
    $cache = $script:OEP_CACHE_DIR
    if (Test-Path (Join-Path $cache ".git")) {
        if (-not (Update-Cache)) {
            Write-Host "Cache $cache is unusable; re-cloning..."
            Remove-Item -Recurse -Force $cache
            New-Cache
        }
    } else {
        if (Test-Path $cache) {
            Write-Host "Removing stale $cache (not a git checkout)..."
            Remove-Item -Recurse -Force $cache
        }
        New-Cache
    }
    $base = if ($script:OEP_KEEP_ROOT) { $cache } else { $script:OEP_CACHE_APP_DIR }
    $sentinel = if ($script:OEP_SENTINEL_REL) { Join-Path $base $script:OEP_SENTINEL_REL } else { $script:OEP_CACHE_APP_DIR }
    if (-not (Test-Path $sentinel)) {
        throw "$script:OEP_SUBDIR is missing from $script:OEP_NAME $script:OEP_TAG (expected $sentinel)"
    }
}

# -- Fetch -------------------------------------------------------------

# Copy OEP_SUBDIR from the cache into OEP_SRC_DIR, apply the patch and stamp the ref. keep_root also
# copies the repository's top-level files and keeps the subdir's path (for a path dependency).
function Export-Upstream {
    if ($script:OEP_SRC_DIR -eq $script:OEP_CACHE_DIR -or $script:OEP_SRC_DIR -eq $SCRIPT_DIR -or $script:OEP_SRC_DIR -eq $script:OEP_WORKER_DIR) {
        throw "refusing to copy $script:OEP_NAME into $script:OEP_SRC_DIR"
    }
    if (Test-Path $script:OEP_SRC_DIR) { Remove-Item -Recurse -Force $script:OEP_SRC_DIR }
    New-Item -ItemType Directory -Force -Path (Split-Path $script:OEP_SRC_DIR -Parent) | Out-Null
    Write-Host "Copying $script:OEP_SUBDIR ($script:OEP_TAG) to $script:OEP_SRC_DIR..."
    if ($script:OEP_KEEP_ROOT) {
        New-Item -ItemType Directory -Force -Path $script:OEP_SRC_DIR | Out-Null
        Get-ChildItem -Path $script:OEP_CACHE_DIR -File -Force | Copy-Item -Destination $script:OEP_SRC_DIR -Force
        $target = Join-Path $script:OEP_SRC_DIR ($script:OEP_SUBDIR -replace "/", "\")
        New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
        Copy-Item -Path $script:OEP_CACHE_APP_DIR -Destination $target -Recurse -Force
    } else {
        # The destination does not exist, so Copy-Item creates it as a copy of
        # the source directory (dotfiles included).
        Copy-Item -Path $script:OEP_CACHE_APP_DIR -Destination $script:OEP_SRC_DIR -Recurse -Force
    }
    if (-not (Test-Path $script:OEP_SENTINEL)) {
        throw "copy is incomplete (expected $script:OEP_SENTINEL)"
    }
    if ($script:OEP_PATCH_FILE) {
        if (-not (Test-Path $script:OEP_PATCH_FILE)) { throw "patch $script:OEP_PATCH_FILE listed for $script:OEP_NAME does not exist" }
        Write-Host "Applying $(Split-Path $script:OEP_PATCH_FILE -Leaf) to $script:OEP_SRC_DIR (-p$($script:OEP_PATCH_STRIP))..."
        # The copy sits inside this repository; capping repository discovery
        # at its parent makes git apply treat it as plain files (like patch).
        $previous = $env:GIT_CEILING_DIRECTORIES
        $env:GIT_CEILING_DIRECTORIES = Split-Path $script:OEP_SRC_DIR -Parent
        try {
            $ErrorActionPreference = "Continue"
            & git -C $script:OEP_SRC_DIR apply --whitespace=nowarn "-p$($script:OEP_PATCH_STRIP)" $script:OEP_PATCH_FILE
            $code = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = "Stop"
            $env:GIT_CEILING_DIRECTORIES = $previous
        }
        if ($code -ne 0) { throw "$(Split-Path $script:OEP_PATCH_FILE -Leaf) does not apply to $script:OEP_NAME $script:OEP_TAG" }
    }
    [System.IO.File]::WriteAllText($script:OEP_REF_FILE, "$($script:OEP_TAG)`n", (New-Object System.Text.UTF8Encoding $false))
    Write-Host "$script:OEP_LABEL $script:OEP_TAG ready."
}

# Ensure OEP_SRC_DIR is the upstream code at OEP_TAG. Skipped when the copy
# on disk already carries that ref and is complete.
function Ensure-Upstream {
    if ($script:OEP_EXTERNAL) {
        if (-not (Test-Path $script:OEP_SENTINEL)) {
            throw "$($script:OEP_HOME_ENV)=$($script:OEP_SRC_DIR) does not contain $script:OEP_SUBDIR (expected $script:OEP_SENTINEL)"
        }
        Write-Host "$($script:OEP_LABEL): using $script:OEP_SRC_DIR from `$$($script:OEP_HOME_ENV) (not fetched)."
        return
    }
    # Per-worker sparse clones from older checkouts are unused.
    $legacy = Join-Path $script:OEP_WORKER_DIR "thirdparty\edge-ai-libraries"
    if ($legacy -ne $script:OEP_CACHE_DIR -and (Test-Path (Join-Path $legacy ".git"))) {
        Write-Host "Removing the per-worker clone $legacy (replaced by $script:OEP_SRC_DIR)..."
        Remove-Item -Recurse -Force $legacy
    }
    $current = Get-CheckedOutTag
    if ($current -eq $script:OEP_TAG -and (Test-Path $script:OEP_SENTINEL)) {
        Write-Host "$($script:OEP_LABEL) already at $script:OEP_TAG."
        return
    }
    if (Test-Path $script:OEP_SRC_DIR) {
        $shown = if ($current) { $current } else { "unknown" }
        Write-Host "$($script:OEP_LABEL) copy at $script:OEP_SRC_DIR is at '$shown', want $script:OEP_TAG. Remaking..."
    }
    Ensure-Cache
    Export-Upstream
}

function Apply-Overlay {
    if (-not (Test-Path $script:OEP_OVERLAY_DIR)) { return }
    Write-Host "Applying native overlay to $($script:OEP_SRC_DIR):"
    Get-ChildItem -Path $script:OEP_OVERLAY_DIR -Recurse -File | ForEach-Object {
        $relative = $_.FullName.Substring($script:OEP_OVERLAY_DIR.Length).TrimStart("\", "/")
        Write-Host "  - $relative"
        $target = Join-Path $script:OEP_SRC_DIR $relative
        New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
        Copy-Item -Path $_.FullName -Destination $target -Force
    }
}

# Several workers can start at once and all go through the caches, so a
# fetch holds a machine-wide mutex for its whole duration.
function Invoke-Fetch {
    $mutex = New-Object System.Threading.Mutex($false, "Local\DemoStudioOepSetup")
    $acquired = $false
    try {
        try {
            $acquired = $mutex.WaitOne([TimeSpan]::FromSeconds(900))
        } catch [System.Threading.AbandonedMutexException] {
            $acquired = $true
        }
        if (-not $acquired) { throw "timed out waiting for another oep-setup.ps1 to finish" }
        Ensure-Upstream
        Apply-Overlay
    } finally {
        if ($acquired) { $mutex.ReleaseMutex() | Out-Null }
        $mutex.Dispose()
    }
}

function Show-Info {
    $overlay = if (Test-Path $script:OEP_OVERLAY_DIR) {
        (Get-ChildItem -Path $script:OEP_OVERLAY_DIR -Recurse -File | ForEach-Object { $_.FullName.Substring($script:OEP_OVERLAY_DIR.Length).TrimStart("\", "/") }) -join " "
    } else { "none" }
    $fromEnv = if ($script:OEP_KIND -eq "service" -and $env:EDGE_AI_LIBRARIES_REF) { " (from EDGE_AI_LIBRARIES_REF)" } else { "" }
    $external = if ($script:OEP_EXTERNAL) { " (from `$$($script:OEP_HOME_ENV), not fetched)" } else { "" }
    $root = if ($script:OEP_KEEP_ROOT) { " (plus the repository's top-level files)" } else { "" }
    $patch = if ($script:OEP_PATCH_FILE) { "$script:OEP_PATCH_FILE (-p$($script:OEP_PATCH_STRIP))" } else { "none" }
    Write-Host "worker:    $script:OEP_WORKER ($script:OEP_WORKER_DIR)"
    Write-Host "kind:      $script:OEP_KIND ($script:OEP_NAME)"
    Write-Host "upstream:  $script:OEP_REPO_URL"
    Write-Host "subdir:    $script:OEP_SUBDIR$root"
    Write-Host "ref:       $script:OEP_TAG$fromEnv"
    Write-Host "source:    $script:OEP_SRC_DIR$external"
    Write-Host "cache:     $script:OEP_CACHE_DIR"
    Write-Host "on disk:   $(Get-CheckedOutTag)"
    Write-Host "patch:     $patch"
    Write-Host "overlay:   $overlay"
}

# -- Inventory ---------------------------------------------------------

function Write-Row { param([string[]]$Cells) "{0,-38} {1,-13} {2,-52} {3,-17} {4,-17} {5}" -f $Cells }

function Read-EnvVar([string]$File, [string]$Key) {
    if (-not (Test-Path $File)) { return "" }
    foreach ($line in Get-Content $File) {
        $trimmed = ($line -replace '#.*$', '').Trim()
        if (-not $trimmed) { continue }
        $parts = $trimmed.Split('=', 2)
        if ($parts.Count -eq 2 -and $parts[0].Trim() -eq $Key) { return $parts[1].Trim() }
    }
    return ""
}

function Format-Ref([string]$Ref) { if ($Ref -match '^[0-9a-f]{40}$') { return $Ref.Substring(0, 12) }; return $Ref }

# One inventory row for the loaded record; returns $true when it is stale.
function Write-RecordRow([string]$ListMode, [string]$Upstream) {
    $state = "ok"
    if ($script:OEP_EXTERNAL) {
        $current = "(external)"
        if (-not (Test-Path $script:OEP_SENTINEL)) { $state = "MISSING" }
    } elseif (Test-Path $script:OEP_SENTINEL) {
        $current = Get-CheckedOutTag
        if ($current -ne $script:OEP_TAG) { $state = "STALE" }
    } else {
        $current = "(not fetched)"
        $state = "MISSING"
    }
    $adaptation = "none"
    if (Test-Path $script:OEP_OVERLAY_DIR) {
        $count = (Get-ChildItem -Path $script:OEP_OVERLAY_DIR -Recurse -File | Measure-Object).Count
        $adaptation = "overlay/ ($count files)"
    }
    if ($script:OEP_PATCH_FILE) { $adaptation = if ($adaptation -eq "none") { $script:OEP_PATCH } else { "$script:OEP_PATCH, $adaptation" } }
    Write-Row @($script:OEP_WORKER, "native", $Upstream, (Format-Ref $script:OEP_TAG), (Format-Ref $current), $adaptation)
    if ($ListMode -eq "check" -and $state -ne "ok") {
        Write-Host ("{0,-38} >> {1}: expected {2} at {3} (run: .\oep-setup.ps1 fetch {4})" -f "", $state, $script:OEP_TAG, $script:OEP_SRC_DIR, $script:OEP_WORKER)
        return $true
    }
    return $false
}

function Show-List([string]$ListMode) {
    $stale = $false
    Write-Host "OEP microservices from edge-ai-libraries (catalogue: $CATALOG_FILE, tag: $script:PINNED_TAG, cache: $OEP_LIBRARIES_CACHE_DIR)"
    Write-Host ""
    Write-Row @("worker", "runtime", "upstream", "pinned", "on disk", "native adaptation")
    Write-Row @("------", "-------", "--------", "------", "-------", "-----------------")
    foreach ($record in ($script:RECORDS | Where-Object { $_.kind -eq "service" })) {
        Use-Record $record
        if (Write-RecordRow $ListMode "edge-ai-libraries/$script:OEP_SUBDIR") { $stale = $true }
    }

    Write-Host ""
    Write-Host "Vendored git sources (catalogue `"sources`", one sparse clone each under $SOURCES_CACHE_ROOT)"
    Write-Host ""
    Write-Row @("worker", "runtime", "upstream", "pinned", "on disk", "native adaptation")
    Write-Row @("------", "-------", "--------", "------", "-------", "-----------------")
    foreach ($record in ($script:RECORDS | Where-Object { $_.kind -eq "source" })) {
        Use-Record $record
        $short = ($script:OEP_REPO_URL -replace '^https?://(www\.)?github\.com/', '') -replace '\.git$', ''
        if (Write-RecordRow $ListMode "$short/$script:OEP_SUBDIR") { $stale = $true }
    }

    Write-Host ""
    Write-Host "OEP suite apps from edge-ai-suites (suites\*\*\suite.env, docker compose, Linux only; EDGE_AI_SUITES_REF overrides)"
    Write-Host ""
    $suiteRoot = Join-Path $SCRIPT_DIR "suites"
    if (Test-Path $suiteRoot) {
        Get-ChildItem -Path $suiteRoot -Recurse -Depth 2 -File -Filter "suite.env" | Sort-Object FullName | ForEach-Object {
            $dir = $_.DirectoryName
            $rel = $dir.Substring($SCRIPT_DIR.Length).TrimStart("\", "/") -replace "\\", "/"
            $pinned = Read-EnvVar $_.FullName "EDGE_AI_SUITES_REF"
            if (-not $pinned) { return }
            $subdir = Read-EnvVar $_.FullName "EDGE_AI_SUITES_APP_PATH"
            if (-not $subdir) { $subdir = $rel -replace "^suites/", "" }
            $refFile = Join-Path $dir "src\.demo-studio-edge-ai-suites-ref"
            $current = if (Test-Path $refFile) { (Get-Content $refFile -Raw).Trim() } else { "(not cloned)" }
            Write-Row @($rel, "docker/linux", "edge-ai-suites/$subdir", $pinned, $current, "compose override at start")
            if ($ListMode -eq "check" -and $current -ne $pinned) {
                $stale = $true
                $state = if (Test-Path $refFile) { "STALE" } else { "MISSING" }
                Write-Host ("{0,-38} >> {1}: expected {2} in {3}" -f "", $state, $pinned, $refFile)
            }
        }
    }

    Write-Host ""
    Write-Host "Custom workers (not catalogued; code lives in this repository):"
    # Workers live at services\<name>, services\<group>\<backend> and
    # engines\<name>; a directory is a worker when it has a start script.
    $catalogued = $script:RECORDS | ForEach-Object { $_.worker }
    foreach ($root in @("services", "engines")) {
        $rootPath = Join-Path $SCRIPT_DIR $root
        if (-not (Test-Path $rootPath)) { continue }
        Get-ChildItem -Path $rootPath -Recurse -Depth 2 -File -Filter "start.ps1" | Sort-Object FullName | ForEach-Object {
            if ($_.FullName -like "*\thirdparty\*") { return }
            $name = $_.DirectoryName.Substring($SCRIPT_DIR.Length).TrimStart("\", "/") -replace "\\", "/"
            if ($catalogued -contains $name) { return }
            Write-Host "  $name"
        }
    }

    if ($ListMode -eq "check") {
        Write-Host ""
        if ($stale) { Write-Host "Some copies are missing or not at their pinned ref."; exit 1 }
        Write-Host "All copies match their pins."
    }
}

function Set-Pin([string]$NewTag) {
    if (-not $NewTag) { Write-Host "ERROR: pin needs a tag, e.g. .\oep-setup.ps1 pin 2026.2.1" -ForegroundColor Red; exit 64 }
    # Rewrite only the top-level "tag" value (the first "tag" key in the file,
    # which precedes "services") so the file keeps its formatting.
    $content = Get-Content $CATALOG_FILE -Raw
    $updated = [regex]::new('("tag"\s*:\s*")[^"]*(")').Replace($content, ('${1}' + $NewTag + '${2}'), 1)
    [System.IO.File]::WriteAllText($CATALOG_FILE, $updated, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "tag is now $NewTag in oep-services.json. Run '.\oep-setup.ps1 fetch --all' (or start each worker) to remake the copies."
}

# -- Entry point -------------------------------------------------------

Read-Catalog
switch ($Mode) {
    "list"  { Show-List "list" }
    "check" { Show-List "check" }
    "fetch" {
        if ($Target -eq "--all") {
            foreach ($record in $script:RECORDS) { Use-Record $record; Invoke-Fetch }
        } elseif ($Target) {
            foreach ($record in (Get-WorkerRecords $Target)) { Use-Record $record; Invoke-Fetch }
        } else {
            Write-Host "ERROR: fetch needs a worker name or --all" -ForegroundColor Red; exit 64
        }
    }
    "info"  {
        if (-not $Target) { Write-Host "ERROR: info needs a worker name" -ForegroundColor Red; exit 64 }
        foreach ($record in (Get-WorkerRecords $Target)) { Use-Record $record; Show-Info; Write-Host "" }
    }
    "tag"   { if ($env:EDGE_AI_LIBRARIES_REF) { $env:EDGE_AI_LIBRARIES_REF.Trim() } else { $script:PINNED_TAG } }
    "pin"   { Set-Pin $Target }
    "help"  { Get-Content $PSCommandPath | Select-String -Pattern "^# Usage:" -Context 0, 8 | ForEach-Object { $_.Line; $_.Context.PostContext } }
}
