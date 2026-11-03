// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { LucideIcon } from 'lucide-react'
import {
  Cpu,
  Loader,
  MemoryStick,
  Monitor,
  RefreshCw,
  TriangleAlert,
  Zap,
} from 'lucide-react'
import { EmptyState } from '@/components/common/empty-state'
import { InlineNotice } from '@/components/common/inline-notice'
import { UtilizationCard } from '@/components/dashboard/utilization-card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSystemInfo } from '@/context/system-info-context'
import { useSystemMonitoringOverview } from '@/hooks/use-system-monitoring'
import { plural } from '@/lib/browser/format'
import type {
  GpuTool,
  NpuMetric,
  NpuSource,
} from '@/lib/system/system-monitoring'

const MIB = 1024 ** 2

/** Shown when the GPU tool is not installed; Windows' counters always are. */
const GPU_TOOL_HINTS: Partial<Record<GpuTool, string>> = {
  qmassa:
    'GPU usage is read with qmassa, which setup builds; run setup again to install it.',
}

/** Who took the GPU readings, as a reason names it. */
const GPU_TOOL_NAMES: Record<GpuTool, string> = {
  qmassa: 'qmassa',
  'windows-performance-counters': 'Windows',
}

const NPU_UNAVAILABLE_REASONS: Record<
  NpuSource,
  { usage: string; memory: string }
> = {
  intel_vpu: {
    usage: 'The kernel counts no busy time for this NPU.',
    memory: 'The kernel does not report this NPU’s memory use.',
  },
  'windows-performance-counters': {
    usage: 'Windows reported no utilization for this NPU.',
    memory: 'Windows reported no memory use for this NPU.',
  },
}

/** `512 MB`, `42.3 GB`: a memory size, in the binary units system monitors use. */
function formatMemory(bytes: number): string {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${Math.round(bytes / MIB)} MB`
}

/** `3.2 GB of 16.0 GB used` (`system memory` for a device without its own), or what is known. */
function memoryDetail(
  usedBytes: number | null,
  totalBytes: number | null,
  suffix: 'used' | 'system memory' = 'used',
): string | undefined {
  if (usedBytes !== null && totalBytes !== null && totalBytes > 0) {
    return `${formatMemory(usedBytes)} of ${formatMemory(totalBytes)} ${suffix}`
  }
  if (totalBytes !== null && totalBytes > 0) {
    return `${formatMemory(totalBytes)} total`
  }
  return undefined
}

/**
 * The NPU's current clock (the load covers the whole interval), and a warning when the kernel
 * counts no busy time, so the load is powered-on time.
 */
function npuUsageDetail(npu: NpuMetric): string | undefined {
  const parts: string[] = []
  if (npu.frequencyMhz !== null && npu.maxFrequencyMhz !== null) {
    parts.push(
      npu.frequencyMhz > 0
        ? `${npu.frequencyMhz} of ${npu.maxFrequencyMhz} MHz`
        : `Powered down now (up to ${npu.maxFrequencyMhz} MHz)`,
    )
  }
  if (npu.utilizationSource === 'active-time') {
    parts.push('Time powered on: this kernel counts no NPU busy time')
  }
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/** OpenVINO's GPU ids among the devices `/api/system-info` found (`GPU`, `GPU.0`, …). */
const isGpuDeviceId = (id: string) => /^GPU(\.\d+)?$/.test(id)

function LoadingSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="grid grid-cols-1 gap-4 md:grid-cols-2"
    >
      <span className="sr-only">Loading system metrics…</span>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} aria-hidden="true" className="glass-card rounded-xl p-4">
          <Skeleton className="mb-3 h-4 w-28" />
          <Skeleton className="h-16 w-full" />
        </div>
      ))}
    </div>
  )
}

/** One device's usage + memory cards; `contents` keeps both in the parent's 2-column grid. */
function DeviceUtilizationPair({
  kind,
  id,
  device,
  icon,
  usage,
  usageDetail,
  usageUnavailableReason,
  usageHistory,
  memoryUsage,
  memoryDetail,
  memoryUnavailableReason,
  memoryHistory,
  updatedAt,
}: {
  kind: 'GPU' | 'NPU'
  id: string
  device: string
  icon: LucideIcon
  usage: number | null
  usageDetail?: string
  usageUnavailableReason: string
  usageHistory?: number[]
  memoryUsage: number | null
  memoryDetail?: string
  memoryUnavailableReason: string
  memoryHistory?: number[]
  updatedAt?: string
}) {
  const testId = `metric-${kind.toLowerCase()}`
  // An NPU of unknown model is named just `NPU`: no "NPU — NPU".
  const named = (what: string) =>
    device === kind ? what : `${what} — ${device}`
  return (
    <div className="contents">
      <UtilizationCard
        label={named(kind)}
        value={usage}
        detail={usageDetail}
        unavailableReason={usageUnavailableReason}
        icon={icon}
        colorClass="text-success"
        history={usageHistory}
        updatedAt={updatedAt}
        data-testid={`${testId}-${id}`}
      />
      <UtilizationCard
        label={named(`${kind} memory`)}
        value={memoryUsage}
        detail={memoryDetail}
        unavailableReason={memoryUnavailableReason}
        icon={MemoryStick}
        colorClass="text-success"
        history={memoryHistory}
        updatedAt={updatedAt}
        data-testid={`${testId}-memory-${id}`}
      />
    </div>
  )
}

/**
 * A device family whose readings could not be taken at all: what this
 * machine has, if the device check found any, and why there are no figures.
 */
function DevicesUnavailable({
  kind,
  icon,
  detected,
  reason,
  hint,
}: {
  kind: 'GPU' | 'NPU'
  icon: LucideIcon
  /** The device ids `/api/system-info` found for this family. */
  detected: string[]
  reason: string
  /** What would make the readings available, when it is known. */
  hint?: string
}) {
  // `GPU.0, GPU.1` names them; a lone bare `NPU` adds nothing.
  const ids =
    detected.length === 1 && detected[0] === kind
      ? ''
      : ` (${detected.join(', ')})`
  const found =
    detected.length === 0
      ? ''
      : detected.length === 1
        ? `This machine has ${kind === 'NPU' ? 'an' : 'a'} ${kind}${ids}, but its usage can’t be read. `
        : `This machine has ${plural(detected.length, kind)}${ids}, but their usage can’t be read. `
  return (
    <EmptyState
      icon={icon}
      title={`${kind} usage unavailable`}
      description={
        <span data-testid={`${kind.toLowerCase()}-unavailable-reason`}>
          {found}
          {reason}
          {hint && ` ${hint}`}
        </span>
      }
      size="sm"
      className="glass-card rounded-xl px-6 py-8"
    />
  )
}

function RetryButton({
  onRetry,
  retrying,
}: {
  onRetry: () => void
  retrying: boolean
}) {
  return (
    <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
      {retrying ? <Loader className="animate-spin" /> : <RefreshCw />}
      {retrying ? 'Trying again…' : 'Try again'}
    </Button>
  )
}

/**
 * CPU, memory, GPU and NPU usage. A failed refresh keeps the last figures under a notice; only a
 * failed first load shows the error instead.
 */
export function SystemMetrics() {
  const {
    data: monitoring,
    isPending,
    isError,
    isFetching,
    refetch,
  } = useSystemMonitoringOverview()
  const { systemInfo } = useSystemInfo()
  const retry = () => void refetch()

  if (isPending) return <LoadingSkeleton />

  if (!monitoring) {
    return (
      <EmptyState
        icon={TriangleAlert}
        title="System metrics are unavailable"
        description="The studio could not read this machine's hardware usage. It keeps trying in the background."
        tone="warning"
      >
        <div className="mt-4">
          <RetryButton onRetry={retry} retrying={isFetching} />
        </div>
      </EmptyState>
    )
  }

  const cpuModel = monitoring.cpu.modelName?.replace(/\s+/g, ' ').trim()
  const cpuDetail = [cpuModel, plural(monitoring.cpu.cores, 'logical core')]
    .filter(Boolean)
    .join(' · ')
  const { gpus, npus, history, memory, timestamp } = monitoring
  // What the device check found, to say what a missing reading is missing.
  const detectedGpus = systemInfo?.devices.filter(isGpuDeviceId) ?? []
  const detectedNpus =
    systemInfo?.devices.filter((id) => id === 'NPU' || /^NPU\./.test(id)) ?? []
  const npuReason = monitoring.npuUnavailableReason

  return (
    <>
      {isError && (
        <InlineNotice
          tone="warning"
          size="sm"
          role="status"
          className="flex-wrap"
          icon={
            <TriangleAlert
              aria-hidden="true"
              className="text-warning h-4 w-4 shrink-0"
            />
          }
        >
          <span className="mr-3">
            The latest update failed — these figures may be out of date.
          </span>
          <RetryButton onRetry={retry} retrying={isFetching} />
        </InlineNotice>
      )}

      <section aria-labelledby="cpu-title">
        <h2
          id="cpu-title"
          className="text-foreground mb-4 text-lg font-semibold"
        >
          CPU
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <UtilizationCard
            label="CPU"
            value={monitoring.cpu.usagePercent}
            detail={cpuDetail}
            unavailableReason="The operating system reported no CPU time for the last interval."
            icon={Cpu}
            colorClass="text-primary"
            history={history.cpuUsagePercent}
            updatedAt={timestamp}
            data-testid="metric-cpu"
          />
          <UtilizationCard
            label="System memory"
            value={memory.usagePercent}
            detail={memoryDetail(memory.usedBytes, memory.totalBytes)}
            unavailableReason="The operating system did not report the memory size."
            icon={MemoryStick}
            colorClass="text-info"
            history={history.memoryUsagePercent}
            updatedAt={timestamp}
            data-testid="metric-memory"
          />
        </div>
      </section>

      <section aria-labelledby="gpu-title">
        <h2
          id="gpu-title"
          className="text-foreground mb-4 text-lg font-semibold"
        >
          GPU
        </h2>
        {gpus.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {gpus.map((gpu) => (
              <DeviceUtilizationPair
                key={gpu.id}
                kind="GPU"
                id={gpu.id}
                device={gpu.device}
                icon={Monitor}
                usage={gpu.utilizationPercent}
                usageUnavailableReason={
                  gpu.statsError ??
                  `${GPU_TOOL_NAMES[gpu.source]} reported no utilization for this GPU.`
                }
                usageHistory={history.gpuUsagePercentByDevice[gpu.id]}
                memoryUsage={gpu.memoryUtilizationPercent}
                memoryDetail={memoryDetail(
                  gpu.memoryUsedMiB === null ? null : gpu.memoryUsedMiB * MIB,
                  gpu.memoryTotalMiB === null ? null : gpu.memoryTotalMiB * MIB,
                  gpu.sharedMemory ? 'system memory' : 'used',
                )}
                memoryUnavailableReason={
                  gpu.statsError ??
                  `${GPU_TOOL_NAMES[gpu.source]} reported no memory use for this GPU.`
                }
                memoryHistory={history.gpuMemoryUsagePercentByDevice[gpu.id]}
                updatedAt={timestamp}
              />
            ))}
          </div>
        ) : monitoring.gpuUnavailableReason ? (
          <DevicesUnavailable
            kind="GPU"
            icon={Monitor}
            detected={detectedGpus}
            reason={monitoring.gpuUnavailableReason}
            hint={
              monitoring.gpuToolAvailable
                ? undefined
                : GPU_TOOL_HINTS[monitoring.gpuTool]
            }
          />
        ) : (
          <EmptyState
            icon={Monitor}
            title="No GPU detected"
            description={`${GPU_TOOL_NAMES[monitoring.gpuTool]} found no GPU on this machine.`}
            size="sm"
            className="glass-card rounded-xl px-6 py-8"
          />
        )}
      </section>

      {/* Only with NPU readings, or a detected NPU whose readings failed. */}
      {npus.length > 0 ? (
        <section aria-labelledby="npu-title">
          <h2
            id="npu-title"
            className="text-foreground mb-4 text-lg font-semibold"
          >
            NPU
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {npus.map((npu) => (
              <DeviceUtilizationPair
                key={npu.id}
                kind="NPU"
                id={npu.id}
                device={npu.device}
                icon={Zap}
                usage={npu.utilizationPercent}
                usageDetail={npuUsageDetail(npu)}
                usageUnavailableReason={
                  NPU_UNAVAILABLE_REASONS[npu.source].usage
                }
                usageHistory={history.npuUsagePercentByDevice[npu.id]}
                memoryUsage={npu.memoryUtilizationPercent}
                memoryDetail={
                  npu.memoryUsedBytes === null
                    ? undefined
                    : `${formatMemory(npu.memoryUsedBytes)} of ${formatMemory(memory.totalBytes)} system memory`
                }
                memoryUnavailableReason={
                  NPU_UNAVAILABLE_REASONS[npu.source].memory
                }
                memoryHistory={history.npuMemoryUsagePercentByDevice[npu.id]}
                updatedAt={timestamp}
              />
            ))}
          </div>
        </section>
      ) : (
        detectedNpus.length > 0 &&
        npuReason && (
          <section aria-labelledby="npu-title">
            <h2
              id="npu-title"
              className="text-foreground mb-4 text-lg font-semibold"
            >
              NPU
            </h2>
            <DevicesUnavailable
              kind="NPU"
              icon={Zap}
              detected={detectedNpus}
              reason={npuReason}
            />
          </section>
        )
      )}
    </>
  )
}
