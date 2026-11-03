// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Live machine metrics: CPU/memory from Node; on Linux GPUs from qmassa and NPUs from intel_vpu
 * sysfs, on Windows both from the GPU performance counters Task Manager reads. Sampled at most once
 * per MIN_SAMPLE_INTERVAL_MS however many tabs poll.
 */

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { REPO_ROOT, WORKER_DIR } from '@/lib/constants'
import { globalSingleton } from '@/lib/global-singleton'
import { logger } from '@/lib/logger'
import { MONITORING_POLL_INTERVAL_MS } from '@/lib/monitoring-interval'
import {
  CommandInterruptedError,
  type CommandResult,
  isCommandMissing,
  runCommand,
} from '@/lib/system/spawn'
import {
  type GpuCounterReading,
  parseGpuCounterReading,
  parseWindowsAdapters,
  type WindowsAdapter,
  windowsAdapterUsage,
} from '@/lib/system/windows-gpu-counters'

export interface CpuMetric {
  /** Load over the last sampling interval; `null` when the OS reports no CPU times. */
  usagePercent: number | null
  /** Logical cores. */
  cores: number
  modelName: string | null
}

export interface GpuMetric {
  id: string
  device: string
  vendor: string | null
  busaddr: string | null
  utilizationPercent: number | null
  memoryUsedMiB: number | null
  memoryTotalMiB: number | null
  /** Used over total memory; `null` when either is unknown. */
  memoryUtilizationPercent: number | null
  /** Integrated GPU: the total is system RAM and the use what its buffers hold there. */
  sharedMemory: boolean
  /** Why a reading of this GPU is missing; `null` when none is. */
  statsError: string | null
  source: GpuTool
}

/** What reads GPU usage: qmassa on Linux, the GPU performance counters on Windows. */
export type GpuTool = 'qmassa' | 'windows-performance-counters'

export interface NpuMetric {
  /** PCI address on Linux (`0000:00:0b.0`), adapter LUID on Windows. */
  id: string
  /** Linux: codename from the PCI device id (`Arrow Lake`), `NPU` when unknown. Windows: the driver's name. */
  device: string
  /** Busy share of the last sampling interval; `null` when none is counted. */
  utilizationPercent: number | null
  /** `active-time` (kernels before 6.11 lack a busy counter) is power-on time and overstates use. */
  utilizationSource: NpuBusySource | null
  /** 0 while the NPU is powered down. */
  frequencyMhz: number | null
  maxFrequencyMhz: number | null
  /** What the NPU's buffers hold; it has no memory of its own, only system memory. */
  memoryUsedBytes: number | null
  /** `memoryUsedBytes` over system memory. */
  memoryUtilizationPercent: number | null
  source: NpuSource
}

type NpuBusySource = 'busy-time' | 'active-time'

/** What reads NPU usage: intel_vpu sysfs on Linux, the GPU performance counters on Windows. */
export type NpuSource = 'intel_vpu' | 'windows-performance-counters'

export interface MemoryMetric {
  totalBytes: number
  usedBytes: number
  freeBytes: number
  /** `null` when the OS reports no memory size. */
  usagePercent: number | null
}

export interface MonitoringHistory {
  cpuUsagePercent: number[]
  memoryUsagePercent: number[]
  gpuUsagePercentByDevice: Record<string, number[]>
  gpuMemoryUsagePercentByDevice: Record<string, number[]>
  npuUsagePercentByDevice: Record<string, number[]>
  /** Share of system memory in NPU buffers. */
  npuMemoryUsagePercentByDevice: Record<string, number[]>
}

/** What `GET /api/system-monitoring` answers. */
export interface SystemMonitoringOverview {
  timestamp: string
  cpu: CpuMetric
  memory: MemoryMetric
  gpus: GpuMetric[]
  npus: NpuMetric[]
  gpuTool: GpuTool
  /** Whether `gpuTool` is installed. */
  gpuToolAvailable: boolean
  npuAvailable: boolean
  /** Why the GPU tool gave no reading (missing, failing, timed out); `null` when it ran. */
  gpuUnavailableReason: string | null
  /** Why the NPU could not be read; `null` when it was. */
  npuUnavailableReason: string | null
  /** Up to `MAX_HISTORY_POINTS` samples, one per sampling interval. */
  history: MonitoringHistory
}

const isWindows = os.platform() === 'win32'
const COMMAND_TIMEOUT_MS = 2500
/** Four minutes of history. */
const MAX_HISTORY_POINTS = (4 * 60_000) / MONITORING_POLL_INTERVAL_MS
/**
 * Start to start, just under the client's poll so each poll gets a fresh sample. Not counted from
 * the end: a sample takes ~2 s (qmassa), so a 5 s poll would find it too new every other time.
 */
const MIN_SAMPLE_INTERVAL_MS = MONITORING_POLL_INTERVAL_MS - 1_000
const LINUX_NPU_LABEL = 'NPU'

/** The first sample's CPU/NPU load window; later ones span the poll interval. */
const FIRST_WINDOW_MS = 500

/** Where Linux lists accelerators; Intel NPUs are the ones intel_vpu binds. */
const ACCEL_CLASS_DIR = '/sys/class/accel'

/** NPU codenames by PCI device id, from the intel_vpu driver's device table. */
const NPU_CODENAMES: Readonly<Record<string, string>> = {
  '7d1d': 'Meteor Lake',
  ad1d: 'Arrow Lake',
  '643e': 'Lunar Lake',
  b03e: 'Panther Lake',
  fd3e: 'Wildcat Lake',
  d71d: 'Nova Lake',
}

/** GPU engine usage is the busy time between two qmassa samples this far apart. */
const QMASSA_WINDOW_MS = 1000

/** After a failed listing of the Windows adapters, how long before trying again. */
const ADAPTERS_RETRY_MS = 60_000

const MIB = 1024 ** 2

type CommandKey = 'qmassa' | 'gpuCounters' | 'gpuAdapters'

/** A command the monitor may run: the program, and the arguments every call starts with. */
interface AllowedCommand {
  /** What reasons and logs call it. */
  name: string
  command: string
  baseArgs: readonly string[]
  /** `COMMAND_TIMEOUT_MS` when unset. */
  timeoutMs?: number
}

const powershellScript = (
  script: string,
  timeoutMs: number,
): AllowedCommand => ({
  name: script,
  command: 'powershell',
  baseArgs: [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(WORKER_DIR, 'scripts', script),
  ],
  timeoutMs,
})

const COMMAND_REGISTRY: Readonly<Record<CommandKey, AllowedCommand | null>> = {
  // Built by setup_thirdparty.sh. Writes two samples as JSON lines and sleeps once more after the
  // second, hence twice the window plus margin.
  qmassa: isWindows
    ? null
    : {
        name: 'qmassa',
        command: path.join(REPO_ROOT, 'thirdparty', 'qmassa', 'bin', 'qmassa'),
        baseArgs: [
          '--no-tui',
          '--nr-iterations',
          '2',
          '--ms-interval',
          `${QMASSA_WINDOW_MS}`,
        ],
        timeoutMs: 2 * QMASSA_WINDOW_MS + COMMAND_TIMEOUT_MS,
      },
  // Usually under a second; the first read after Windows unloads the counter provider takes several.
  gpuCounters: isWindows ? powershellScript('gpu-counters.ps1', 10_000) : null,
  // Compiles a C# helper first.
  gpuAdapters: isWindows ? powershellScript('gpu-adapters.ps1', 30_000) : null,
}

const emptyHistory = (): MonitoringHistory => ({
  cpuUsagePercent: [],
  memoryUsagePercent: [],
  gpuUsagePercentByDevice: {},
  gpuMemoryUsagePercentByDevice: {},
  npuUsagePercentByDevice: {},
  npuMemoryUsagePercentByDevice: {},
})

// One sampler per process: the route is the only reader, but a dev reload
// must not reset the history or the CPU baseline.
const sampler = globalSingleton(
  'systemMonitoringSampler',
  (): {
    previousCpu: { idle: number; total: number } | null
    history: MonitoringHistory
    last?: { at: number; value: SystemMonitoringOverview }
    inFlight?: Promise<SystemMonitoringOverview>
  } => ({ previousCpu: null, history: emptyHistory() }),
)

/** Each NPU's busy counter at the previous sample, by PCI address. */
const previousNpu = globalSingleton(
  'systemMonitoringNpuBaselines',
  () => new Map<string, NpuBusySample>(),
)

/** Windows: the counters as last read, to measure load since, and the adapters as last listed. */
const windowsCounters = globalSingleton(
  'systemMonitoringWindowsCounters',
  (): { previous?: GpuCounterReading; adapters?: WindowsAdaptersRead } => ({}),
)

interface WindowsAdaptersRead {
  at: number
  outcome: { adapters: WindowsAdapter[] } | { reason: string }
  /** The LUIDs the counters named at the time, listed adapters or not. */
  luids: Set<string>
}

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const appendHistory = (history: number[], value: number | null): void => {
  if (value === null || !Number.isFinite(value)) return
  history.push(Math.max(0, Math.min(100, value)))
  if (history.length > MAX_HISTORY_POINTS) {
    history.splice(0, history.length - MAX_HISTORY_POINTS)
  }
}

const appendDeviceHistory = (
  historyByDevice: Record<string, number[]>,
  deviceId: string,
  value: number | null,
): void => {
  if (!historyByDevice[deviceId]) {
    historyByDevice[deviceId] = []
  }
  appendHistory(historyByDevice[deviceId], value)
}

const pruneDeviceHistory = (
  historyByDevice: Record<string, number[]>,
  activeDeviceIds: Set<string>,
): void => {
  for (const deviceId of Object.keys(historyByDevice)) {
    if (!activeDeviceIds.has(deviceId)) {
      delete historyByDevice[deviceId]
    }
  }
}

const DEVICE_ID_PATTERN =
  /^(?:[0-9a-fA-F]{4}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}\.[0-7]|[0-9]{1,4})$/

/** Runs one of the allowed monitoring commands; rejects when it cannot. */
const runAllowed = (key: CommandKey, args: readonly string[]) => {
  const allowed = COMMAND_REGISTRY[key]
  if (!allowed) {
    return Promise.reject(
      new Error(`Command "${key}" is not available on this platform`),
    )
  }
  return runCommand(allowed.command, [...allowed.baseArgs, ...args], {
    timeoutMs: allowed.timeoutMs ?? COMMAND_TIMEOUT_MS,
  })
}

/** At most this much of a command's own error text goes into a reason. */
const MAX_REASON_DETAIL = 200

/** The last line a failed command printed, the useful part of its error. */
const lastOutputLine = (result: CommandResult): string | null => {
  const lines = `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const line = lines.at(-1)
  if (!line) return null
  return line.length > MAX_REASON_DETAIL
    ? `${line.slice(0, MAX_REASON_DETAIL)}…`
    : line
}

/** Why a monitoring command gave no reading, in words for the page. */
const failureReason = (
  key: CommandKey,
  outcome: { result: CommandResult } | { error: unknown },
): string => {
  const allowed = COMMAND_REGISTRY[key]
  const name = allowed?.name ?? key
  if ('result' in outcome) {
    const detail = lastOutputLine(outcome.result)
    const code = outcome.result.exitCode
    return `${name} failed${code === null ? '' : ` (exit code ${code})`}${detail ? `: ${detail}` : '.'}`
  }
  const { error } = outcome
  if (isCommandMissing(error)) return `${name} is not installed.`
  if (error instanceof CommandInterruptedError && error.reason === 'timeout') {
    const timeoutMs = allowed?.timeoutMs ?? COMMAND_TIMEOUT_MS
    return `${name} did not answer within ${timeoutMs / 1000} s.`
  }
  return `${name} could not run: ${error instanceof Error ? error.message : String(error)}`
}

const readCpuSnapshot = (): { idle: number; total: number } =>
  os.cpus().reduce(
    (acc, { times }) => {
      acc.idle += times.idle
      acc.total += times.user + times.nice + times.sys + times.idle + times.irq
      return acc
    },
    { idle: 0, total: 0 },
  )

const waitFirstWindow = () =>
  new Promise<void>((resolve) => setTimeout(() => resolve(), FIRST_WINDOW_MS))

/**
 * CPU load since the previous sample; the first measures over a short window of its own rather
 * than report 0. `null` when the OS reports no CPU time passing.
 */
const getCpuMetrics = async (): Promise<CpuMetric> => {
  if (!sampler.previousCpu) {
    sampler.previousCpu = readCpuSnapshot()
    await waitFirstWindow()
  }
  const previous = sampler.previousCpu
  const currentSnapshot = readCpuSnapshot()
  const idleDelta = currentSnapshot.idle - previous.idle
  const totalDelta = currentSnapshot.total - previous.total
  sampler.previousCpu = currentSnapshot

  const cpus = os.cpus()
  return {
    usagePercent:
      totalDelta > 0
        ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100))
        : null,
    cores: cpus.length,
    modelName: cpus[0]?.model?.trim() ?? null,
  }
}

const getMemoryMetrics = (): MemoryMetric => {
  const totalBytes = os.totalmem()
  const freeBytes = os.freemem()
  const usedBytes = totalBytes - freeBytes
  return {
    totalBytes,
    usedBytes,
    freeBytes,
    usagePercent: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : null,
  }
}

type GpuReadings = Pick<
  SystemMonitoringOverview,
  'gpus' | 'gpuTool' | 'gpuToolAvailable' | 'gpuUnavailableReason'
>
type NpuReadings = Pick<
  SystemMonitoringOverview,
  'npus' | 'npuAvailable' | 'npuUnavailableReason'
>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The newest sample of a qmassa series (each keeps its last 40). */
const lastSample = (series: unknown): unknown =>
  Array.isArray(series) ? series.at(-1) : undefined

const positiveOrNull = (value: number | null): number | null =>
  value !== null && value > 0 ? value : null

const QMASSA_STATE_ERROR = 'qmassa wrote no device stats'

/** The devices in qmassa's last JSON line, the second sample. */
const readQmassaDevices = (json: string): Record<string, unknown>[] => {
  const line = json
    .split('\n')
    .findLast((text) => text.includes('"devs_state"'))
  if (!line) throw new Error(QMASSA_STATE_ERROR)
  const state: unknown = JSON.parse(line)
  if (!isRecord(state) || !Array.isArray(state.devs_state)) {
    throw new Error(QMASSA_STATE_ERROR)
  }
  return state.devs_state.filter(isRecord)
}

/**
 * pci.ids copies, freshest first: setup_thirdparty.sh's, then the system's,
 * which is often older than the GPU (Ubuntu 24.04's has no Arc B-series).
 */
const PCI_IDS_FILES = [
  path.join(REPO_ROOT, 'thirdparty', 'pci.ids'),
  '/usr/share/misc/pci.ids',
  '/usr/share/hwdata/pci.ids',
]

/** `vendor:device` (lowercase hex) → its pci.ids name, `null` when none has it. */
const pciNames = globalSingleton(
  'pciDeviceNames',
  () => new Map<string, string | null>(),
)

/**
 * Caches the pci.ids names of `ids` (`8086:e211`) from the first file that has each. Vendors are
 * unindented, devices one tab in, deeper lines subsystems; `C` lines start device classes.
 */
const lookupPciNames = async (ids: string[]): Promise<void> => {
  const missing = new Set(ids.filter((id) => !pciNames.has(id)))
  for (const file of PCI_IDS_FILES) {
    if (missing.size === 0) break
    const text = await readFile(/* turbopackIgnore: true */ file, 'utf8').catch(
      () => '',
    )
    let vendor = ''
    for (const line of text.split('\n')) {
      const match = /^(\t?)([0-9a-f]{4})\s+(.+)$/.exec(line)
      if (!match) {
        if (line.startsWith('C ')) vendor = ''
        continue
      }
      const [, indent, hex, name] = match
      if (!indent) vendor = hex
      else if (vendor && missing.delete(`${vendor}:${hex}`)) {
        pciNames.set(`${vendor}:${hex}`, name.trim())
      }
    }
  }
  for (const id of missing) pciNames.set(id, null)
}

/**
 * `Battlemage G21 [Arc Pro B60]` → `Intel Arc Pro B60 (Battlemage G21)`:
 * pci.ids keeps the product name in brackets after the codename.
 */
const friendlyGpuName = (vendor: string | null, pciName: string): string => {
  const match = /^(.+?)\s*\[(.+)\]$/.exec(pciName)
  const [model, codename] = match ? [match[2], match[1]] : [pciName, null]
  const named =
    vendor && !model.startsWith(vendor) ? `${vendor} ${model}` : model
  return codename ? `${named} (${codename})` : named
}

/** `8086:e211`: how pci.ids and `pciNames` key a qmassa device. */
const qmassaPciId = (dev: Record<string, unknown>): string =>
  typeof dev.pci_id === 'string' ? dev.pci_id.toLowerCase() : ''

/**
 * The GPU's pci.ids name, else the one udev knows, else its kind and PCI
 * ID — qmassa puts the bare device ID where udev has no name.
 */
const qmassaDeviceName = (
  dev: Record<string, unknown>,
  kind: string,
): { device: string; vendor: string | null } => {
  const pciId = qmassaPciId(dev)
  const [vendorId = '', deviceId = ''] = pciId.split(':')
  const vendor = vendorId === '8086' ? 'Intel' : null
  const pciName = pciNames.get(pciId)
  if (pciName) return { device: friendlyGpuName(vendor, pciName), vendor }
  const name = typeof dev.vdr_dev === 'string' ? dev.vdr_dev : ''
  if (name && !name.toLowerCase().endsWith(` ${deviceId}`)) {
    return { device: name.replace(/^Intel Corporation /, ''), vendor }
  }
  return {
    device: `${vendor ?? 'Unknown'} ${kind}GPU${pciId ? ` (${pciId.toUpperCase()})` : ''}`,
    vendor,
  }
}

/**
 * What the processes qmassa can see (this user's) hold in one kind of
 * memory, for when the driver tells only root the device's total. 0 is a
 * reading (none of them holds any), `null` means qmassa listed no clients.
 */
const qmassaClientsBytes = (
  dev: Record<string, unknown>,
  key: 'vram_used' | 'smem_used',
): number | null =>
  Array.isArray(dev.clis_stats)
    ? dev.clis_stats
        .filter(isRecord)
        .map((client) => lastSample(client.mem_info))
        .reduce<number>(
          (sum, info) =>
            sum + (isRecord(info) ? (toNumber(info[key]) ?? 0) : 0),
          0,
        )
    : null

const qmassaGpuMetric = (dev: Record<string, unknown>): GpuMetric | null => {
  const id = typeof dev.pci_dev === 'string' ? dev.pci_dev : ''
  if (!id) return null
  const stats = isRecord(dev.dev_stats) ? dev.dev_stats : {}
  const devType = isRecord(dev.dev_type) ? dev.dev_type : {}
  const discrete = 'Discrete' in devType

  // The busiest engine: a GPU kept busy by one kind of work is busy.
  const engines = Object.values(
    isRecord(stats.eng_usage) ? stats.eng_usage : {},
  )
    .map((series) => toNumber(lastSample(series)))
    .filter((value): value is number => value !== null)
  const utilizationPercent =
    engines.length > 0 ? Math.max(0, Math.min(100, Math.max(...engines))) : null

  const memInfo = lastSample(stats.mem_info)
  const mem = isRecord(memInfo) ? memInfo : {}
  let totalBytes: number | null
  let usedBytes: number | null
  if (discrete) {
    totalBytes = toNumber(mem.vram_total)
    // xe before Linux 6.18, and i915, tell only root the VRAM in use.
    usedBytes =
      positiveOrNull(toNumber(mem.vram_used)) ??
      qmassaClientsBytes(dev, 'vram_used')
  } else {
    // An iGPU has no VRAM: its buffers are in system RAM. i915 reports
    // only each process's share, so an idle iGPU sums to 0.
    totalBytes = toNumber(mem.smem_total)
    usedBytes =
      positiveOrNull(toNumber(mem.smem_used)) ??
      qmassaClientsBytes(dev, 'smem_used')
  }

  const { device, vendor } = qmassaDeviceName(
    dev,
    discrete ? 'discrete ' : 'Integrated' in devType ? 'integrated ' : '',
  )
  return {
    id,
    device,
    vendor,
    busaddr: DEVICE_ID_PATTERN.test(id) ? id : null,
    utilizationPercent,
    memoryUsedMiB: usedBytes === null ? null : usedBytes / (1024 * 1024),
    memoryTotalMiB: totalBytes === null ? null : totalBytes / (1024 * 1024),
    memoryUtilizationPercent:
      usedBytes !== null && totalBytes !== null && totalBytes > 0
        ? (usedBytes / totalBytes) * 100
        : null,
    sharedMemory: !discrete,
    statsError: null,
    source: 'qmassa',
  }
}

/**
 * Without root, engine usage counts only this user's processes — every
 * worker the app runs, but not other users' GPU work.
 */
const getQmassaGpuMetrics = async (): Promise<GpuReadings> => {
  // A file, not /dev/stdout: Node gives the child a socket there, which
  // qmassa cannot open.
  let dir: string | undefined
  try {
    dir = await mkdtemp(path.join(os.tmpdir(), 'qmassa-'))
    const jsonPath = path.join(dir, 'stats.json')
    const result = await runAllowed('qmassa', ['--to-json', jsonPath])
    if (result.exitCode !== 0) {
      return {
        gpus: [],
        gpuTool: 'qmassa',
        gpuToolAvailable: true,
        gpuUnavailableReason: failureReason('qmassa', { result }),
      }
    }
    const json = await readFile(jsonPath, 'utf8').catch(() => '')
    const devices = readQmassaDevices(json)
    await lookupPciNames(devices.map(qmassaPciId).filter(Boolean))
    const gpus = devices
      .map(qmassaGpuMetric)
      .filter((gpu): gpu is GpuMetric => gpu !== null)
    return {
      gpus,
      gpuTool: 'qmassa',
      gpuToolAvailable: true,
      gpuUnavailableReason: null,
    }
  } catch (error) {
    const missing = isCommandMissing(error)
    if (!missing) logger.debug('qmassa failed:', error)
    return {
      gpus: [],
      gpuTool: 'qmassa',
      gpuToolAvailable: !missing,
      gpuUnavailableReason: failureReason('qmassa', { error }),
    }
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true })
  }
}

interface NpuDevice {
  /** PCI address, e.g. `0000:00:0b.0`. */
  id: string
  /** The PCI device's sysfs directory, which holds the driver's counters. */
  dir: string
  device: string
}

/** A busy counter reading, in milliseconds, and when it was taken. */
interface NpuBusySample {
  ms: number
  source: NpuBusySource
  at: number
}

/** `KEY=value` lines, as in a sysfs `uevent` file. */
const parseUevent = (text: string): Record<string, string> =>
  Object.fromEntries(
    text.split('\n').flatMap((line) => {
      const at = line.indexOf('=')
      return at > 0 ? [[line.slice(0, at), line.slice(at + 1).trim()]] : []
    }),
  )

/** The NPUs intel_vpu has bound; none when the driver is not loaded. */
const findNpus = async (): Promise<NpuDevice[]> => {
  const entries = await readdir(ACCEL_CLASS_DIR).catch(() => [])
  const npus: NpuDevice[] = []
  for (const entry of entries.filter((name) => /^accel\d+$/.test(name))) {
    const dir = path.join(ACCEL_CLASS_DIR, entry, 'device')
    const uevent = parseUevent(
      await readFile(path.join(dir, 'uevent'), 'utf8').catch(() => ''),
    )
    if (uevent.DRIVER !== 'intel_vpu' || !uevent.PCI_SLOT_NAME) continue
    const pciDevice = uevent.PCI_ID?.split(':')[1]?.toLowerCase() ?? ''
    npus.push({
      id: uevent.PCI_SLOT_NAME,
      dir,
      device: NPU_CODENAMES[pciDevice] ?? LINUX_NPU_LABEL,
    })
  }
  return npus
}

/** The number a sysfs file holds; `null` when it is missing or holds none. */
const readSysfsNumber = async (file: string): Promise<number | null> =>
  toNumber(await readFile(file, 'utf8').catch(() => null))

/**
 * The driver's busy counter (Linux 6.11+), else runtime-PM active time: power-on time, which
 * overstates use by the autosuspend delay and is meaningless unless runtime PM is `auto`.
 */
const readNpuBusy = async (
  dir: string,
): Promise<Omit<NpuBusySample, 'at'> | null> => {
  const busyUs = await readSysfsNumber(path.join(dir, 'npu_busy_time_us'))
  if (busyUs !== null) return { ms: busyUs / 1000, source: 'busy-time' }
  const control = await readFile(path.join(dir, 'power', 'control'), 'utf8')
    .then((text) => text.trim())
    .catch(() => null)
  if (control !== 'auto') return null
  const activeMs = await readSysfsNumber(
    path.join(dir, 'power', 'runtime_active_time'),
  )
  return activeMs === null ? null : { ms: activeMs, source: 'active-time' }
}

/**
 * One NPU's readings; load is busy time since `previous` over elapsed time. Like the CPU, a first
 * sample measures over a short window of its own.
 */
const sampleNpu = async (
  npu: NpuDevice,
  previous: NpuBusySample | undefined,
): Promise<{ metric: NpuMetric; sample: NpuBusySample | null }> => {
  let start = previous
  if (!start) {
    const first = await readNpuBusy(npu.dir)
    if (first) {
      start = { ...first, at: performance.now() }
      await waitFirstWindow()
    }
  }
  const [busy, frequencyMhz, maxFrequencyMhz, memoryUsedBytes] =
    await Promise.all([
      readNpuBusy(npu.dir),
      readSysfsNumber(path.join(npu.dir, 'npu_current_frequency_mhz')),
      readSysfsNumber(path.join(npu.dir, 'npu_max_frequency_mhz')),
      readSysfsNumber(path.join(npu.dir, 'npu_memory_utilization')),
    ])
  const sample = busy && { ...busy, at: performance.now() }
  // A counter that went back (driver reloaded) reads 0 once.
  const utilizationPercent =
    sample && start && start.source === sample.source && sample.at > start.at
      ? Math.max(
          0,
          Math.min(
            100,
            ((sample.ms - start.ms) / (sample.at - start.at)) * 100,
          ),
        )
      : null
  const totalBytes = os.totalmem()
  return {
    metric: {
      id: npu.id,
      device: npu.device,
      utilizationPercent,
      utilizationSource: sample?.source ?? null,
      frequencyMhz,
      maxFrequencyMhz,
      memoryUsedBytes,
      memoryUtilizationPercent:
        memoryUsedBytes !== null && totalBytes > 0
          ? (memoryUsedBytes / totalBytes) * 100
          : null,
      source: 'intel_vpu',
    },
    sample,
  }
}

/** Linux: the NPUs intel_vpu has bound. */
const getNpuMetrics = async (): Promise<NpuReadings> => {
  const devices = await findNpus()
  const sampled = await Promise.all(
    devices.map((npu) => sampleNpu(npu, previousNpu.get(npu.id))),
  )
  previousNpu.clear()
  for (const { metric, sample } of sampled) {
    if (sample) previousNpu.set(metric.id, sample)
  }
  if (sampled.length === 0) {
    return {
      npus: [],
      npuAvailable: false,
      npuUnavailableReason: `The intel_vpu driver lists no NPU under ${ACCEL_CLASS_DIR}.`,
    }
  }
  return {
    npus: sampled.map(({ metric }) => metric),
    npuAvailable: true,
    npuUnavailableReason: null,
  }
}

/** Runs a monitoring script that takes no arguments and parses what it prints, or says why not. */
const readScript = async <T>(
  key: CommandKey,
  parse: (stdout: string) => T,
): Promise<{ value: T } | { reason: string }> => {
  const name = COMMAND_REGISTRY[key]?.name ?? key
  try {
    const result = await runAllowed(key, [])
    if (result.exitCode !== 0) return { reason: failureReason(key, { result }) }
    try {
      return { value: parse(result.stdout) }
    } catch (error) {
      logger.debug(`${name} printed no reading:`, error)
      const detail = lastOutputLine(result)
      return {
        reason: `${name} returned no reading${detail ? `: ${detail}` : '.'}`,
      }
    }
  } catch (error) {
    logger.debug(`${name} failed:`, error)
    return { reason: failureReason(key, { error }) }
  }
}

const readWindowsAdapters = async (): Promise<
  WindowsAdaptersRead['outcome']
> => {
  const read = await readScript('gpuAdapters', parseWindowsAdapters)
  return 'value' in read ? { adapters: read.value } : read
}

/**
 * Windows: the GPUs and NPUs, listed again only when the counters name an adapter they did not
 * then (a restarted driver gets a new LUID), or a minute after a listing that failed. `pending` is
 * a listing already under way.
 */
const getWindowsAdapters = async (
  reading: GpuCounterReading,
  pending?: Promise<WindowsAdaptersRead['outcome']>,
): Promise<WindowsAdaptersRead['outcome']> => {
  const known = windowsCounters.adapters
  const luids = [...reading.memory.keys()]
  if (!pending && known) {
    const upToDate =
      'adapters' in known.outcome
        ? luids.every((luid) => known.luids.has(luid))
        : Date.now() - known.at < ADAPTERS_RETRY_MS
    if (upToDate) return known.outcome
  }
  const outcome = await (pending ?? readWindowsAdapters())
  windowsCounters.adapters = { at: Date.now(), outcome, luids: new Set(luids) }
  return outcome
}

const percentOf = (used: number, total: number | null): number | null =>
  total !== null && total > 0 ? Math.min(100, (used / total) * 100) : null

/**
 * Windows: GPUs and NPUs from the GPU performance counters. Load is measured since the previous
 * sample; the first measures over a short window of its own, like the CPU's.
 */
const getWindowsMetrics = async (): Promise<GpuReadings & NpuReadings> => {
  const unavailable = (reason: string): GpuReadings & NpuReadings => ({
    gpus: [],
    gpuTool: 'windows-performance-counters',
    gpuToolAvailable: true,
    gpuUnavailableReason: reason,
    npus: [],
    npuAvailable: false,
    npuUnavailableReason: reason,
  })

  // Listing the adapters takes longest: the first time, it runs while the counters are read.
  const pendingAdapters = windowsCounters.adapters
    ? undefined
    : readWindowsAdapters()
  if (!windowsCounters.previous) {
    const baseline = await readScript('gpuCounters', parseGpuCounterReading)
    if ('reason' in baseline) return unavailable(baseline.reason)
    windowsCounters.previous = baseline.value
    await waitFirstWindow()
  }
  const previous = windowsCounters.previous
  const reading = await readScript('gpuCounters', parseGpuCounterReading)
  if ('reason' in reading) return unavailable(reading.reason)
  windowsCounters.previous = reading.value

  const listed = await getWindowsAdapters(reading.value, pendingAdapters)
  if ('reason' in listed) return unavailable(listed.reason)

  const usage = windowsAdapterUsage(
    listed.adapters,
    previous,
    reading.value,
    os.totalmem(),
  )
  const gpus = usage
    .filter(({ adapter }) => adapter.kind === 'gpu')
    .map((device): GpuMetric => ({
      id: device.adapter.luid,
      device: device.adapter.name,
      vendor: device.adapter.manufacturer,
      busaddr: null,
      utilizationPercent: device.utilizationPercent,
      memoryUsedMiB: device.memoryUsedBytes / MIB,
      memoryTotalMiB:
        device.memoryTotalBytes === null ? null : device.memoryTotalBytes / MIB,
      memoryUtilizationPercent: percentOf(
        device.memoryUsedBytes,
        device.memoryTotalBytes,
      ),
      sharedMemory: device.sharedMemory,
      statsError:
        device.memoryTotalBytes === null
          ? 'Windows did not report this GPU’s memory size.'
          : null,
      source: 'windows-performance-counters',
    }))
  const npus = usage
    .filter(({ adapter }) => adapter.kind === 'npu')
    .map((device): NpuMetric => ({
      id: device.adapter.luid,
      device: device.adapter.name,
      utilizationPercent: device.utilizationPercent,
      // Engine running time: busy time, not power-on time.
      utilizationSource: 'busy-time',
      frequencyMhz: null,
      maxFrequencyMhz: null,
      memoryUsedBytes: device.memoryUsedBytes,
      memoryUtilizationPercent: percentOf(
        device.memoryUsedBytes,
        device.memoryTotalBytes,
      ),
      source: 'windows-performance-counters',
    }))

  return {
    gpus,
    gpuTool: 'windows-performance-counters',
    gpuToolAvailable: true,
    gpuUnavailableReason: null,
    npus,
    npuAvailable: npus.length > 0,
    npuUnavailableReason:
      npus.length > 0
        ? null
        : 'Windows lists no NPU among its GPU performance counters.',
  }
}

/** Appends each device's readings to its series, and drops the series of devices gone. */
const recordDeviceHistory = (
  devices: readonly {
    id: string
    utilizationPercent: number | null
    memoryUtilizationPercent: number | null
  }[],
  usage: Record<string, number[]>,
  memoryUsage: Record<string, number[]>,
): void => {
  for (const device of devices) {
    appendDeviceHistory(usage, device.id, device.utilizationPercent)
    appendDeviceHistory(memoryUsage, device.id, device.memoryUtilizationPercent)
  }
  const active = new Set(devices.map((device) => device.id))
  pruneDeviceHistory(usage, active)
  pruneDeviceHistory(memoryUsage, active)
}

async function sampleOverview(): Promise<SystemMonitoringOverview> {
  const history = sampler.history
  const [cpu, memory, accelerators] = await Promise.all([
    getCpuMetrics(),
    getMemoryMetrics(),
    isWindows
      ? getWindowsMetrics()
      : Promise.all([getQmassaGpuMetrics(), getNpuMetrics()]).then(
          ([gpu, npu]) => ({ ...gpu, ...npu }),
        ),
  ])

  appendHistory(history.cpuUsagePercent, cpu.usagePercent)
  appendHistory(history.memoryUsagePercent, memory.usagePercent)
  recordDeviceHistory(
    accelerators.gpus,
    history.gpuUsagePercentByDevice,
    history.gpuMemoryUsagePercentByDevice,
  )
  recordDeviceHistory(
    accelerators.npus,
    history.npuUsagePercentByDevice,
    history.npuMemoryUsagePercentByDevice,
  )

  return {
    timestamp: new Date().toISOString(),
    cpu,
    memory,
    ...accelerators,
    history: {
      cpuUsagePercent: [...history.cpuUsagePercent],
      memoryUsagePercent: [...history.memoryUsagePercent],
      gpuUsagePercentByDevice: { ...history.gpuUsagePercentByDevice },
      gpuMemoryUsagePercentByDevice: {
        ...history.gpuMemoryUsagePercentByDevice,
      },
      npuUsagePercentByDevice: { ...history.npuUsagePercentByDevice },
      npuMemoryUsagePercentByDevice: {
        ...history.npuMemoryUsagePercentByDevice,
      },
    },
  }
}

/**
 * The latest metrics, resampled once the last sample started `MIN_SAMPLE_INTERVAL_MS` ago.
 * Concurrent callers share a sample in progress.
 */
export function getSystemOverview(): Promise<SystemMonitoringOverview> {
  const { last } = sampler
  if (last && Date.now() - last.at < MIN_SAMPLE_INTERVAL_MS) {
    return Promise.resolve(last.value)
  }
  if (!sampler.inFlight) {
    const startedAt = Date.now()
    sampler.inFlight = sampleOverview()
      .then((value) => {
        sampler.last = { at: startedAt, value }
        return value
      })
      .finally(() => {
        sampler.inFlight = undefined
      })
  }
  return sampler.inFlight
}
