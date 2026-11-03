# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Runs a worker's start script pinned to the CPUs of a hex affinity mask: the Windows counterpart of
# `numactl -C` for the cpuAffinity setting (frontend/src/lib/workers/process-handler.ts). The processes
# the script starts inherit the mask.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File run-pinned.ps1 <hex mask> <start.ps1> [args...]

$ErrorActionPreference = "Stop"

$Mask, $Script = $args[0], $args[1]
$ScriptArgs = if ($args.Count -gt 2) { $args[2..($args.Count - 1)] } else { @() }
try {
    [System.Diagnostics.Process]::GetCurrentProcess().ProcessorAffinity = [IntPtr][Convert]::ToInt64($Mask, 16)
} catch {
    # Like numactl: refuse to start rather than run unpinned.
    throw "Cannot pin to CPU mask 0x$Mask, does this machine have every CPU in cpuAffinity? $($_.Exception.Message)"
}
& $Script @ScriptArgs
exit $LASTEXITCODE
