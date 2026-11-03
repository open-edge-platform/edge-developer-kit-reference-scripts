# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Prints the raw GPU performance counters Task Manager reads, as JSON: when they were read, each GPU
# engine's running time per process (100 ns ticks) and each adapter's dedicated and shared memory in
# use (bytes). Read through WMI because its class names, unlike Get-Counter paths, are the same in
# every display language.
$ErrorActionPreference = 'Stop'
try {
    $engines = @(Get-CimInstance Win32_PerfRawData_GPUPerformanceCounters_GPUEngine -Property Name, RunningTime, Timestamp_Sys100NS)
    $memory = @(Get-CimInstance Win32_PerfRawData_GPUPerformanceCounters_GPUAdapterMemory -Property Name, DedicatedUsage, SharedUsage, Timestamp_Sys100NS)
} catch {
    # One line: the System page shows it as the reason there are no readings.
    [Console]::Error.WriteLine("Windows GPU performance counters could not be read: $($_.Exception.Message.Trim())")
    exit 1
}
$first = @($engines + $memory) | Select-Object -First 1
$running = @{}
foreach ($engine in $engines) { $running[$engine.Name] = $engine.RunningTime }
ConvertTo-Json -Compress -Depth 3 -InputObject @{
    # No instances at all (no GPU): the clock, so the reading still says when it was taken.
    timestamp = $(if ($first) { $first.Timestamp_Sys100NS } else { [DateTime]::UtcNow.ToFileTimeUtc() })
    engines = $running
    adapters = @($memory | ForEach-Object { @{ name = $_.Name; dedicated = $_.DedicatedUsage; shared = $_.SharedUsage } })
}
