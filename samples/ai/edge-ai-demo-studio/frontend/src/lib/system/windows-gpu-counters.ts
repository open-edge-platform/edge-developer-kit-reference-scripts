// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * GPU and NPU usage on Windows, worked out as Task Manager does from the GPU performance counters
 * (workers/scripts/gpu-counters.ps1) and the adapters they name (workers/scripts/gpu-adapters.ps1).
 */

/** A GPU or NPU, as `gpu-adapters.ps1` lists it. */
export interface WindowsAdapter {
  /** The adapter LUID as the counters spell it: `0x00000000_0x00009c2b`. */
  luid: string
  name: string
  manufacturer: string | null
  kind: 'gpu' | 'npu'
  /** Memory of its own, in bytes; `null` when the driver could not be asked. */
  dedicatedBytes: number | null
}

/** One reading of `gpu-counters.ps1`. */
export interface GpuCounterReading {
  /** 100 ns ticks. */
  timestamp: number
  /** Running time in 100 ns ticks, by engine instance (`pid_…_luid_…_phys_…_eng_…_engtype_…`). */
  engines: Map<string, number>
  /** Dedicated and shared memory in use, in bytes, by adapter LUID. */
  memory: Map<string, { dedicated: number; shared: number }>
}

export interface WindowsAdapterUsage {
  adapter: WindowsAdapter
  /** The busiest engine's load; `null` when the two readings were taken at the same time. */
  utilizationPercent: number | null
  memoryUsedBytes: number
  /** A discrete GPU's own memory, else system memory; `null` when the driver gave no sizes. */
  memoryTotalBytes: number | null
  /** The adapter's memory is system memory: an integrated GPU or an NPU. */
  sharedMemory: boolean
}

const ENGINE_INSTANCE =
  /^pid_\d+_luid_(0x[0-9a-f]{8}_0x[0-9a-f]{8})_phys_(\d+)_eng_(\d+)_engtype_/i
const ADAPTER_INSTANCE = /^luid_(0x[0-9a-f]{8}_0x[0-9a-f]{8})_phys_\d+$/i

/** An Arc card has this much memory of its own; an integrated GPU a small carve-out at most. */
const DISCRETE_MIN_DEDICATED_BYTES = 1024 ** 3

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

/** ConvertTo-Json writes a lone item without its array. */
const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value == null ? [] : [value]

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null

/** The adapters in `gpu-adapters.ps1`'s output; throws when it is not JSON. */
export function parseWindowsAdapters(stdout: string): WindowsAdapter[] {
  const adapters: WindowsAdapter[] = []
  for (const item of asArray(JSON.parse(stdout || '[]'))) {
    const record = asRecord(item)
    const luid = asString(record?.luid)?.toLowerCase()
    const name = asString(record?.name)
    if (!record || !luid || !name) continue
    adapters.push({
      luid,
      name,
      manufacturer: asString(record.manufacturer),
      kind: record.kind === 'npu' ? 'npu' : 'gpu',
      dedicatedBytes: asNumber(record.dedicatedBytes),
    })
  }
  return adapters
}

/** The counters in `gpu-counters.ps1`'s output; throws when it is not JSON or has no timestamp. */
export function parseGpuCounterReading(stdout: string): GpuCounterReading {
  const json = asRecord(JSON.parse(stdout)) ?? {}
  // 100 ns ticks since 1601 exceed 2^53: the few ticks lost are noise.
  const timestamp = asNumber(json.timestamp)
  if (timestamp === null) throw new Error('The counters carry no timestamp')

  const engines = new Map<string, number>()
  for (const [instance, value] of Object.entries(
    asRecord(json.engines) ?? {},
  )) {
    const running = asNumber(value)
    if (running !== null) engines.set(instance, running)
  }

  const memory = new Map<string, { dedicated: number; shared: number }>()
  for (const item of asArray(json.adapters)) {
    const record = asRecord(item)
    const match = ADAPTER_INSTANCE.exec(asString(record?.name) ?? '')
    if (!record || !match) continue
    const luid = match[1].toLowerCase()
    // A linked adapter has one instance per physical GPU.
    const sum = memory.get(luid) ?? { dedicated: 0, shared: 0 }
    sum.dedicated += asNumber(record.dedicated) ?? 0
    sum.shared += asNumber(record.shared) ?? 0
    memory.set(luid, sum)
  }

  return { timestamp, engines, memory }
}

/**
 * Each adapter's busiest engine between two readings, in percent, by LUID: the running time the
 * engine gained, over all processes, over the time between them. `null` when no time passed.
 */
function busiestEngineByAdapter(
  previous: GpuCounterReading,
  current: GpuCounterReading,
): Map<string, number> | null {
  const elapsed = current.timestamp - previous.timestamp
  if (elapsed <= 0) return null

  const gained = new Map<string, number>()
  for (const [instance, running] of current.engines) {
    const match = ENGINE_INSTANCE.exec(instance)
    if (!match) continue
    const before = previous.engines.get(instance)
    // An instance the earlier reading lacks (a process that began using the engine since, or a
    // reused pid) gained all its time since then.
    const delta =
      before !== undefined && running >= before ? running - before : running
    const engine = `${match[1].toLowerCase()}/${match[2]}/${match[3]}`
    gained.set(engine, (gained.get(engine) ?? 0) + delta)
  }

  const busiest = new Map<string, number>()
  for (const [engine, ticks] of gained) {
    const luid = engine.slice(0, engine.indexOf('/'))
    const load = Math.min(100, (ticks / elapsed) * 100)
    busiest.set(luid, Math.max(busiest.get(luid) ?? 0, load))
  }
  return busiest
}

/**
 * Load and memory of each listed adapter between two readings. An adapter the counters do not
 * measure (a remote display adapter) is left out, as are counters no listed adapter owns.
 */
export function windowsAdapterUsage(
  adapters: readonly WindowsAdapter[],
  previous: GpuCounterReading,
  current: GpuCounterReading,
  systemMemoryBytes: number,
): WindowsAdapterUsage[] {
  const busiest = busiestEngineByAdapter(previous, current)
  return adapters.flatMap((adapter): WindowsAdapterUsage[] => {
    const used = current.memory.get(adapter.luid)
    if (!used) return []
    // No engine instance: no process used the adapter between the readings.
    const utilizationPercent = busiest && (busiest.get(adapter.luid) ?? 0)
    const { dedicatedBytes } = adapter
    if (
      adapter.kind === 'gpu' &&
      (dedicatedBytes === null ||
        dedicatedBytes >= DISCRETE_MIN_DEDICATED_BYTES)
    ) {
      // A discrete GPU, measured by its own memory as Task Manager's "Dedicated GPU memory".
      return [
        {
          adapter,
          utilizationPercent,
          memoryUsedBytes: used.dedicated,
          memoryTotalBytes: dedicatedBytes,
          sharedMemory: false,
        },
      ]
    }
    return [
      {
        adapter,
        utilizationPercent,
        memoryUsedBytes: used.dedicated + used.shared,
        memoryTotalBytes: systemMemoryBytes,
        sharedMemory: true,
      },
    ]
  })
}
