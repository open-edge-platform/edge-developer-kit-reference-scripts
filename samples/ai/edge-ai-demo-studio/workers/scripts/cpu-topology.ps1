# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Prints each logical processor's id and efficiency class as JSON (GetSystemCpuSetInformation), for the
# Windows P-/E-core split in frontend/src/lib/system/system-info.ts.
$ErrorActionPreference = "Stop"

Add-Type -Namespace EdgeAiStudio -Name CpuSets -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool GetSystemCpuSetInformation(IntPtr info, uint length, out uint returned, IntPtr process, uint flags);
'@
$len = [uint32]0
[void][EdgeAiStudio.CpuSets]::GetSystemCpuSetInformation([IntPtr]::Zero, 0, [ref]$len, [IntPtr]::Zero, 0)
$buf = [Runtime.InteropServices.Marshal]::AllocHGlobal([int]$len)
try {
    if (-not [EdgeAiStudio.CpuSets]::GetSystemCpuSetInformation($buf, $len, [ref]$len, [IntPtr]::Zero, 0)) { exit 1 }
    $cpus = @()
    $off = 0
    while ($off -lt $len) {
        # SYSTEM_CPU_SET_INFORMATION: Size @0; CpuSet.Group @12, LogicalProcessorIndex @14, EfficiencyClass @18
        $size = [Runtime.InteropServices.Marshal]::ReadInt32($buf, $off)
        $group = [Runtime.InteropServices.Marshal]::ReadInt16($buf, $off + 12)
        $cpus += [pscustomobject]@{
            id = $group * 64 + [Runtime.InteropServices.Marshal]::ReadByte($buf, $off + 14)
            efficiencyClass = [Runtime.InteropServices.Marshal]::ReadByte($buf, $off + 18)
        }
        $off += $size
    }
    ConvertTo-Json -Compress -InputObject $cpus
} finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($buf)
}
