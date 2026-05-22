// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'child_process'
import os from 'os'
import path from 'path'

interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

export interface CpuMetric {
  usagePercent: number
  cores: number
  physicalCores: number
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
  memoryUtilizationPercent: number | null
  source: 'xpu-smi' | 'unavailable'
}

export interface NpuMetric {
  id: string
  device: string
  utilizationPercent: number | null
  memoryUtilizationPercent: number | null
  source: 'windows-device-detection' | 'linux-npu-top' | 'unavailable'
}

export interface MemoryMetric {
  totalBytes: number
  usedBytes: number
  freeBytes: number
  usagePercent: number
}

export interface MonitoringHistory {
  cpuUsagePercent: number[]
  memoryUsagePercent: number[]
  gpuUsagePercentByDevice: Record<string, number[]>
  gpuMemoryUsagePercentByDevice: Record<string, number[]>
  npuUsagePercentByDevice: Record<string, number[]>
  npuMemoryUsagePercentByDevice: Record<string, number[]>
}
const isWindows = os.platform() === 'win32'
const COMMAND_TIMEOUT_MS = 2500
const MAX_HISTORY_POINTS = 24
const LINUX_NPU_ID = 'npu_id'
const LINUX_NPU_LABEL = 'NPU'
const XPU_SMI_COMMAND = isWindows
  ? path.join(
      path.resolve(process.cwd(), '..'),
      'workers',
      'engine',
      'multiserve',
      'engine',
      'xpu-smi',
      'xpu-smi.exe',
    )
  : '/usr/bin/xpu-smi'

let previousCpuSnapshot: { idle: number; total: number } | null = null
const monitoringHistory: MonitoringHistory = {
  cpuUsagePercent: [],
  memoryUsagePercent: [],
  gpuUsagePercentByDevice: {},
  gpuMemoryUsagePercentByDevice: {},
  npuUsagePercentByDevice: {},
  npuMemoryUsagePercentByDevice: {},
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

// To add a new command, extend this object and its type
type CommandKey = 'xpuSmi' | 'npuTop'

const COMMAND_REGISTRY: Readonly<Record<CommandKey, string | null>> = {
  xpuSmi: XPU_SMI_COMMAND,
  npuTop: isWindows
    ? null
    : path.resolve(process.cwd(), '..', 'scripts', 'bash', 'npu_top.sh'),
}

const DEVICE_ID_PATTERN =
  /^(?:[0-9a-fA-F]{4}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}\.[0-7]|[0-9]{1,4})$/

const validateDeviceId = (raw: string): string => {
  if (!DEVICE_ID_PATTERN.test(raw)) {
    throw new Error(
      `Rejected device ID "${raw}": expected a PCI address (e.g. 0000:00:02.0) or a numeric index (0–9999)`,
    )
  }
  return raw
}

const spawnAllowed = (
  key: CommandKey,
  args: readonly string[],
  timeoutMs = COMMAND_TIMEOUT_MS,
): Promise<CommandResult> => {
  const command = COMMAND_REGISTRY[key]
  if (!command) {
    return Promise.reject(
      new Error(`Command "${key}" is not available on this platform`),
    )
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(command, [...args], {
      cwd: process.cwd(),
      env: { ...process.env },
      shell: false,
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data) => {
      stdout += data.toString()
    })
    proc.stderr?.on('data', (data) => {
      stderr += data.toString()
    })
    proc.on('error', reject)
    proc.on('close', (exitCode) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode })
    })

    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      reject(new Error(`Command "${key}" timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })
}

const extractJsonPayload = (stdout: string): unknown => {
  const text = stdout.trim()
  if (!text) throw new Error('xpu-smi returned an empty response')

  const firstBrace = text.indexOf('{')
  const firstBracket = text.indexOf('[')
  const useObject =
    firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket)
  const start = useObject ? firstBrace : firstBracket

  if (start < 0) throw new Error('xpu-smi output did not contain JSON')

  const end = useObject ? text.lastIndexOf('}') : text.lastIndexOf(']')
  if (end < 0 || end <= start)
    throw new Error('xpu-smi output contained incomplete JSON')

  return JSON.parse(text.slice(start, end + 1))
}

const collectRecords = (value: unknown): Record<string, unknown>[] => {
  const records: Record<string, unknown>[] = []

  const walk = (node: unknown) => {
    if (!node) return
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (typeof node === 'object') {
      const record = node as Record<string, unknown>
      records.push(record)
      for (const child of Object.values(record)) walk(child)
    }
  }

  walk(value)
  return records
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

const getGpuMemoryTotalMiB = (
  record: Record<string, unknown>,
): number | null => {
  for (const key of [
    'memory_physical_size_byte',
    'memory_total_size_byte',
    'memory_total',
  ]) {
    const value = toNumber(record[key])
    if (value !== null)
      return key.endsWith('_byte') ? value / (1024 * 1024) : value
  }
  return null
}

const getDiscoveryDeviceId = (
  record: Record<string, unknown>,
): string | null => {
  for (const key of ['device_id', 'deviceId', 'id']) {
    const value = record[key]
    if (typeof value === 'number') return `${value}`
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

const readXpuSmiStats = async (
  deviceId: string,
): Promise<{
  utilizationPercent: number | null
  memoryUsedMiB: number | null
  memoryUtilizationPercent: number | null
}> => {
  try {
    const result = await spawnAllowed('xpuSmi', [
      'stats',
      '-d',
      validateDeviceId(deviceId),
      '-j',
    ])
    if (result.exitCode !== 0)
      return {
        utilizationPercent: null,
        memoryUsedMiB: null,
        memoryUtilizationPercent: null,
      }

    const records = collectRecords(extractJsonPayload(result.stdout))
    let utilizationPercent: number | null = null
    let memoryUsedMiB: number | null = null
    let memoryUtilizationPercent: number | null = null

    for (const record of records) {
      const metricsType =
        typeof record.metrics_type === 'string' ? record.metrics_type : null
      if (!metricsType) continue

      const value = toNumber(record.value) ?? toNumber(record.avg)

      if (
        utilizationPercent === null &&
        !metricsType.includes('MEMORY') &&
        metricsType.includes('UTILIZATION')
      ) {
        utilizationPercent = value
      }
      if (metricsType === 'XPUM_STATS_MEMORY_USED') {
        memoryUsedMiB = value
      }
      if (
        memoryUtilizationPercent === null &&
        metricsType.includes('MEMORY_UTILIZATION')
      ) {
        memoryUtilizationPercent = value
      }
    }

    return { utilizationPercent, memoryUsedMiB, memoryUtilizationPercent }
  } catch {
    return {
      utilizationPercent: null,
      memoryUsedMiB: null,
      memoryUtilizationPercent: null,
    }
  }
}

const getCpuMetrics = (): CpuMetric => {
  const currentSnapshot = readCpuSnapshot()
  let usagePercent = 0

  if (previousCpuSnapshot) {
    const idleDelta = currentSnapshot.idle - previousCpuSnapshot.idle
    const totalDelta = currentSnapshot.total - previousCpuSnapshot.total
    if (totalDelta > 0) usagePercent = (1 - idleDelta / totalDelta) * 100
  }

  previousCpuSnapshot = currentSnapshot
  const cpus = os.cpus()
  const coreCount = cpus.length
  return {
    usagePercent: Math.max(0, Math.min(100, usagePercent)),
    cores: coreCount,
    physicalCores: coreCount,
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
    usagePercent: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0,
  }
}

const getGpuMetrics = async (): Promise<{
  gpus: GpuMetric[]
  xpuSmiAvailable: boolean
}> => {
  try {
    const discovery = await spawnAllowed('xpuSmi', ['discovery', '-j'])
    if (discovery.exitCode !== 0) return { gpus: [], xpuSmiAvailable: true }

    const records = collectRecords(extractJsonPayload(discovery.stdout))
    const devices = records
      .map((record) => {
        const id = getDiscoveryDeviceId(record)
        if (!id) return null
        const device =
          (typeof record.device_name === 'string' && record.device_name) ||
          (typeof record.device_type === 'string' && record.device_type) ||
          `GPU ${id}`
        const busaddr =
          (typeof record.bdf_address === 'string' && record.bdf_address) ||
          (typeof record.bus_address === 'string' && record.bus_address) ||
          null
        return {
          id,
          device,
          busaddr,
          memoryTotalMiB: getGpuMemoryTotalMiB(record),
        }
      })
      .filter((device): device is NonNullable<typeof device> => Boolean(device))

    const gpus = await Promise.all(
      devices.map(async (device) => {
        const stats = await readXpuSmiStats(device.id)
        return {
          id: device.id,
          device: device.device,
          vendor: 'Intel',
          busaddr: device.busaddr,
          utilizationPercent: stats.utilizationPercent,
          memoryUsedMiB: stats.memoryUsedMiB,
          memoryTotalMiB: device.memoryTotalMiB,
          memoryUtilizationPercent: stats.memoryUtilizationPercent,
          source: 'xpu-smi' as const,
        }
      }),
    )

    return { gpus, xpuSmiAvailable: true }
  } catch {
    return { gpus: [], xpuSmiAvailable: false }
  }
}

const getNpuMetrics = async (): Promise<{
  npus: NpuMetric[]
  npuAvailable: boolean
}> => {
  if (isWindows) {
    return { npus: [], npuAvailable: false }
  }

  try {
    const result = await spawnAllowed('npuTop', [])
    if (result.exitCode !== 0) return { npus: [], npuAvailable: false }

    const value = Number.parseFloat(result.stdout.trim())
    if (!Number.isFinite(value)) return { npus: [], npuAvailable: false }

    return {
      npus: [
        {
          id: LINUX_NPU_ID,
          device: LINUX_NPU_LABEL,
          utilizationPercent: Math.max(0, Math.min(100, value)),
          memoryUtilizationPercent: null,
          source: 'linux-npu-top' as const,
        },
      ],
      npuAvailable: true,
    }
  } catch {
    return { npus: [], npuAvailable: false }
  }
}

export const buildOverviewPayload = async () => {
  const [cpu, memory, gpu, npuMetrics] = await Promise.all([
    getCpuMetrics(),
    getMemoryMetrics(),
    getGpuMetrics(),
    getNpuMetrics(),
  ])

  appendHistory(monitoringHistory.cpuUsagePercent, cpu.usagePercent)
  appendHistory(monitoringHistory.memoryUsagePercent, memory.usagePercent)

  const activeGpuIds = new Set(gpu.gpus.map((d) => d.id))
  for (const device of gpu.gpus) {
    const memoryPercent =
      device.memoryUsedMiB !== null &&
      device.memoryTotalMiB !== null &&
      device.memoryTotalMiB > 0
        ? (device.memoryUsedMiB / device.memoryTotalMiB) * 100
        : device.memoryUtilizationPercent
    appendDeviceHistory(
      monitoringHistory.gpuUsagePercentByDevice,
      device.id,
      device.utilizationPercent,
    )
    appendDeviceHistory(
      monitoringHistory.gpuMemoryUsagePercentByDevice,
      device.id,
      memoryPercent,
    )
  }
  pruneDeviceHistory(monitoringHistory.gpuUsagePercentByDevice, activeGpuIds)
  pruneDeviceHistory(
    monitoringHistory.gpuMemoryUsagePercentByDevice,
    activeGpuIds,
  )

  const npu = npuMetrics.npus[0] ?? null
  if (npu) {
    appendDeviceHistory(
      monitoringHistory.npuUsagePercentByDevice,
      LINUX_NPU_ID,
      npu.utilizationPercent,
    )
    monitoringHistory.npuMemoryUsagePercentByDevice[LINUX_NPU_ID] = []
  } else {
    delete monitoringHistory.npuUsagePercentByDevice[LINUX_NPU_ID]
    delete monitoringHistory.npuMemoryUsagePercentByDevice[LINUX_NPU_ID]
  }

  return {
    timestamp: new Date().toISOString(),
    cpu,
    memory,
    ...gpu,
    ...npuMetrics,
    history: {
      cpuUsagePercent: [...monitoringHistory.cpuUsagePercent],
      memoryUsagePercent: [...monitoringHistory.memoryUsagePercent],
      gpuUsagePercentByDevice: { ...monitoringHistory.gpuUsagePercentByDevice },
      gpuMemoryUsagePercentByDevice: {
        ...monitoringHistory.gpuMemoryUsagePercentByDevice,
      },
      npuUsagePercentByDevice: { ...monitoringHistory.npuUsagePercentByDevice },
      npuMemoryUsagePercentByDevice: {
        ...monitoringHistory.npuMemoryUsagePercentByDevice,
      },
    },
  }
}
