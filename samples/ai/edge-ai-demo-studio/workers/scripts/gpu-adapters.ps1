# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Prints the GPUs and NPUs as JSON: each one's adapter LUID as the GPU performance counters spell it
# (0x00000000_0x00009c2b), name, maker, PCI device id, kind (npu for a compute accelerator, else gpu)
# and the dedicated and shared GPU memory Task Manager shows, in bytes (null when it cannot be read).
$ErrorActionPreference = 'Stop'
try {
    Add-Type -Namespace EdgeAiStudio -Name GpuAdapters -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)]
struct OpenAdapterFromLuid { public uint LuidLowPart; public int LuidHighPart; public uint Adapter; }
[StructLayout(LayoutKind.Sequential)]
struct QueryAdapterInfo { public uint Adapter; public int Type; public IntPtr Data; public uint DataSize; }
[DllImport("gdi32.dll")] static extern int D3DKMTOpenAdapterFromLuid(ref OpenAdapterFromLuid open);
[DllImport("gdi32.dll")] static extern int D3DKMTQueryAdapterInfo(ref QueryAdapterInfo query);
[DllImport("gdi32.dll")] static extern int D3DKMTCloseAdapter(ref uint adapter);

// D3DKMT_SEGMENTSIZEINFO (KMTQAITYPE_GETSEGMENTSIZE = 3): dedicated video, dedicated system and shared
// system memory; null when the adapter cannot be opened or asked.
public static ulong[] SegmentSizes(ulong luid) {
    var open = new OpenAdapterFromLuid { LuidLowPart = (uint)luid, LuidHighPart = (int)(luid >> 32) };
    if (D3DKMTOpenAdapterFromLuid(ref open) != 0) return null;
    IntPtr data = Marshal.AllocHGlobal(24);
    try {
        var query = new QueryAdapterInfo { Adapter = open.Adapter, Type = 3, Data = data, DataSize = 24 };
        if (D3DKMTQueryAdapterInfo(ref query) != 0) return null;
        return new[] { (ulong)Marshal.ReadInt64(data, 0), (ulong)Marshal.ReadInt64(data, 8), (ulong)Marshal.ReadInt64(data, 16) };
    } finally {
        Marshal.FreeHGlobal(data);
        D3DKMTCloseAdapter(ref open.Adapter);
    }
}
'@
} catch {
    # Compiling is blocked (constrained language mode): the adapters are still listed, without sizes.
}
$sizes = 'EdgeAiStudio.GpuAdapters' -as [type]
# DEVPKEY_Device_AdapterLuid: the LUID the GPU performance counters name an adapter by.
$luidKey = '{60B193CB-5276-4D0F-96FC-F173ABAD3EC6} 2'
$adapters = @(
    Get-PnpDevice -PresentOnly -Class Display, ComputeAccelerator -ErrorAction SilentlyContinue | ForEach-Object {
        $luid = (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName $luidKey -ErrorAction SilentlyContinue).Data
        if ($null -eq $luid) { return }
        $segments = if ($sizes) { $sizes::SegmentSizes([uint64]$luid) }
        $hex = '{0:x16}' -f [uint64]$luid
        [pscustomobject]@{
            luid = "0x$($hex.Substring(0, 8))_0x$($hex.Substring(8))"
            name = $_.FriendlyName
            manufacturer = $_.Manufacturer
            # PCI\VEN_8086&DEV_E20B&...: what vulkaninfo calls deviceID.
            pciDeviceId = $(if ($_.InstanceId -match '&DEV_([0-9A-Fa-f]{4})') { $Matches[1].ToLower() })
            kind = $(if ($_.Class -eq 'ComputeAccelerator') { 'npu' } else { 'gpu' })
            dedicatedBytes = $(if ($segments) { $segments[0] })
            sharedBytes = $(if ($segments) { $segments[2] })
        }
    }
)
ConvertTo-Json -Compress -InputObject $adapters
