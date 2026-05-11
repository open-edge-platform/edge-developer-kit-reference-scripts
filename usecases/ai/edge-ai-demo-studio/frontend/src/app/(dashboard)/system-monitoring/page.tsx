// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Cpu, MemoryStick, Monitor, Zap } from 'lucide-react'
import { useMemo } from 'react'
import { UtilizationCard } from '@/components/dashboard/utilization-card'
import { Skeleton } from '@/components/ui/skeleton'
import { useSystemMonitoringOverview } from '@/hooks/use-system-monitoring'

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="glass-card rounded-xl p-4">
          <Skeleton className="mb-3 h-4 w-28" />
          <Skeleton className="h-16 w-full" />
        </div>
      ))}
    </div>
  )
}

export default function SystemMonitoringPage() {
  const { data: monitoring, isLoading, isError } = useSystemMonitoringOverview()

  const cpuName = useMemo(() => {
    const model = monitoring?.cpu.modelName?.replace(/\s+/g, ' ').trim()
    if (model) return model
    return monitoring ? `${monitoring.cpu.cores} cores` : null
  }, [monitoring])

  const gpus = monitoring?.gpus ?? []
  const npus = monitoring?.npus ?? []
  const hasGpus = gpus.length > 0 && monitoring?.xpuSmiAvailable
  const hasNpus = npus.length > 0 && monitoring?.npuAvailable

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-foreground text-2xl font-bold">
          System Monitoring
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Current hardware utilization. Refreshes every 10s.
        </p>
      </div>

      {isLoading ? (
        <LoadingSkeleton />
      ) : isError ? (
        <div className="glass-card rounded-xl p-6">
          <p className="text-destructive text-sm">
            Unable to load system metrics. Check the system monitoring route.
          </p>
        </div>
      ) : (
        <>
          {/* CPU */}
          <section>
            <h2 className="text-foreground mb-4 text-lg font-semibold">CPU</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <UtilizationCard
                label={cpuName ? `CPU — ${cpuName}` : 'CPU'}
                value={monitoring?.cpu.usagePercent ?? null}
                icon={Cpu}
                colorClass="text-primary"
                history={monitoring?.history.cpuUsagePercent}
                updatedAt={monitoring?.timestamp}
                intervalSeconds={10}
              />
              <UtilizationCard
                label={cpuName ? `CPU Memory — ${cpuName}` : 'CPU Memory'}
                value={monitoring?.memory.usagePercent ?? null}
                icon={MemoryStick}
                colorClass="text-secondary"
                history={monitoring?.history.memoryUsagePercent}
                updatedAt={monitoring?.timestamp}
                intervalSeconds={10}
              />
            </div>
          </section>

          {/* GPU */}
          <section>
            <h2 className="text-foreground mb-4 text-lg font-semibold">GPU</h2>
            {!hasGpus ? (
              <div className="glass-card rounded-xl p-6">
                <div className="flex items-center gap-3">
                  <Monitor className="text-muted-foreground h-5 w-5" />
                  <p className="text-muted-foreground text-sm">
                    No GPU devices detected. Ensure xpu-smi is available.
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {gpus.map((gpu) => (
                  <div key={gpu.id} className="contents">
                    <UtilizationCard
                      label={`GPU — ${gpu.device}`}
                      value={gpu.utilizationPercent}
                      icon={Monitor}
                      colorClass="text-status-online"
                      history={
                        monitoring?.history.gpuUsagePercentByDevice[gpu.id]
                      }
                      updatedAt={monitoring?.timestamp}
                      intervalSeconds={10}
                    />
                    <UtilizationCard
                      label={`GPU Memory — ${gpu.device}`}
                      value={gpu.memoryUtilizationPercent}
                      icon={MemoryStick}
                      colorClass="text-status-online"
                      history={
                        monitoring?.history.gpuMemoryUsagePercentByDevice[
                          gpu.id
                        ]
                      }
                      updatedAt={monitoring?.timestamp}
                      intervalSeconds={10}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* NPU */}
          {hasNpus && (
            <section>
              <h2 className="text-foreground mb-4 text-lg font-semibold">
                NPU
              </h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {npus.map((npu) => (
                  <div key={npu.id} className="contents">
                    <UtilizationCard
                      label={`NPU — ${npu.device}`}
                      value={npu.utilizationPercent}
                      icon={Zap}
                      colorClass="text-status-online"
                      history={
                        monitoring?.history.npuUsagePercentByDevice[npu.id]
                      }
                      updatedAt={monitoring?.timestamp}
                      intervalSeconds={10}
                    />
                    <UtilizationCard
                      label={`NPU Memory — ${npu.device}`}
                      value={npu.memoryUtilizationPercent ?? 0}
                      icon={MemoryStick}
                      colorClass="text-status-online"
                      history={
                        monitoring?.history.npuMemoryUsagePercentByDevice[
                          npu.id
                        ]
                      }
                      updatedAt={monitoring?.timestamp}
                      intervalSeconds={10}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
