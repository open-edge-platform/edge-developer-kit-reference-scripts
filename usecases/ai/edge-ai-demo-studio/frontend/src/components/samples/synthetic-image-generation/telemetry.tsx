// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Activity, Loader2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  LineChart,
  Line,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { Button } from '@/components/ui/button'

interface DiscoveredGpu {
  device: string
  name?: string
}

interface GpuUtilization {
  device: string
  compute_usage: number
  power: number
  frequency: number
  memory_utilization: number
  media_engine_frequency: number
  memory_used: number
}

interface GpuData {
  name: string
  total_memory: number
  reserved_memory: number
  allocated_memory: number
  compute_usage?: number
  power?: number
  frequency?: number
  memory_utilization?: number
  media_engine_frequency?: number
}

interface SystemMetrics {
  cpu_percent: number
  total_memory: number
  used_memory: number
  free_memory: number
  gpus: Record<string, GpuData>
}

interface MetricsData {
  time: string
  cpu: number
  memory: number
  [key: string]: string | number | undefined
}

export function MetricsDropdown() {
  const [metricsHistory, setMetricsHistory] = useState<MetricsData[]>([])
  const [currentMetrics, setCurrentMetrics] = useState<SystemMetrics | null>(
    null,
  )
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    let interval: NodeJS.Timeout

    if (isOpen) {
      const fetchMetrics = async () => {
        try {
          const [cpuRes, memRes, gpuDiscoveryRes] = await Promise.all([
            fetch('/api/telemetry/cpu'),
            fetch('/api/telemetry/memory'),
            fetch('/api/telemetry/gpu'),
          ])

          const metrics: SystemMetrics = {
            cpu_percent: 0,
            total_memory: 0,
            used_memory: 0,
            free_memory: 0,
            gpus: {},
          }

          if (cpuRes.ok) {
            const cpuData = await cpuRes.json()
            metrics.cpu_percent = parseFloat(cpuData.cpuUsage.toFixed(1))
          }

          if (memRes.ok) {
            const memData = await memRes.json()
            if (memData.total !== 'Not Available') {
              const GB_TO_BYTES = 1024 * 1024 * 1024
              metrics.total_memory = memData.total * GB_TO_BYTES
              metrics.used_memory = memData.used * GB_TO_BYTES
              metrics.free_memory = memData.free * GB_TO_BYTES
            }
          }

          // GPU Handling
          const gpuMetrics: Record<string, number> = {}
          if (gpuDiscoveryRes.ok) {
            const discoveryData = await gpuDiscoveryRes.json()
            if (discoveryData.gpus && Array.isArray(discoveryData.gpus)) {
              // Prepare req for utilization
              const gpuReq = { gpus: discoveryData.gpus }
              const utilRes = await fetch('/api/telemetry/gpu', {
                method: 'POST',
                body: JSON.stringify(gpuReq),
              })

              const utilData = utilRes.ok ? await utilRes.json() : null

              discoveryData.gpus.forEach((gpu: DiscoveredGpu) => {
                const gpuId = gpu.device
                // Initialize GPU data
                metrics.gpus[gpuId] = {
                  name: gpu.name || `GPU ${gpuId}`,
                  total_memory: 0, // Fallback if unknown
                  reserved_memory: 0,
                  allocated_memory: 0,
                }

                // Add telemetry if available
                if (utilData && utilData.gpuUtilizations) {
                  const u = utilData.gpuUtilizations.find(
                    (item: GpuUtilization) => item.device === gpuId,
                  )

                  if (u) {
                    metrics.gpus[gpuId].compute_usage = u.compute_usage
                    metrics.gpus[gpuId].power = u.power
                    metrics.gpus[gpuId].frequency = u.frequency
                    metrics.gpus[gpuId].memory_utilization =
                      u.memory_utilization
                    metrics.gpus[gpuId].media_engine_frequency =
                      u.media_engine_frequency

                    if (u.memory_used) {
                      metrics.gpus[gpuId].allocated_memory =
                        u.memory_used / 1024
                    }

                    if (
                      u.memory_used &&
                      u.memory_utilization &&
                      u.memory_utilization > 0
                    ) {
                      const totalMB =
                        (u.memory_used / u.memory_utilization) * 100
                      metrics.gpus[gpuId].total_memory = totalMB / 1024
                    } else {
                      metrics.gpus[gpuId].total_memory = 0
                    }
                  }
                }

                // Populate history metrics
                gpuMetrics[`gpu_${gpuId}_allocated`] = parseFloat(
                  metrics.gpus[gpuId].allocated_memory.toFixed(1),
                )
                if (metrics.gpus[gpuId].compute_usage !== undefined) {
                  gpuMetrics[`gpu_${gpuId}_util`] =
                    metrics.gpus[gpuId].compute_usage
                }
                if (metrics.gpus[gpuId].memory_utilization !== undefined) {
                  gpuMetrics[`gpu_${gpuId}_mem_util`] =
                    metrics.gpus[gpuId].memory_utilization
                }
              })
            }
          }

          const now = new Date()
          const timeStr = now.toLocaleTimeString([], {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
          const usedMemoryGB = parseFloat(
            (metrics.used_memory / 1024 / 1024 / 1024).toFixed(1),
          )

          setCurrentMetrics(metrics)
          setMetricsHistory((prev) => {
            const newData = [
              ...prev,
              {
                time: timeStr,
                cpu: metrics.cpu_percent,
                memory: usedMemoryGB,
                ...gpuMetrics,
              },
            ]
            // Keep last 30 data points (assuming 1s interval = 30s)
            return newData.slice(-30)
          })
        } catch {
          throw new Error('Failed to fetch system metrics')
        }
      }

      fetchMetrics()
      interval = setInterval(fetchMetrics, 1000)
    }

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [isOpen])

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setMetricsHistory([])
      setCurrentMetrics(null)
    }
    setIsOpen(open)
  }

  const totalMemoryGB = currentMetrics
    ? parseFloat((currentMetrics.total_memory / 1024 / 1024 / 1024).toFixed(1))
    : 16

  const gpuIds =
    currentMetrics?.gpus && Object.keys(currentMetrics.gpus).length > 0
      ? Object.keys(currentMetrics.gpus)
      : []

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Activity className="h-4 w-4" />
          Telemetry
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="flex max-h-[80vh] w-[600px] flex-col p-6"
        align="end"
      >
        <div className="flex h-full flex-col gap-6 overflow-hidden">
          <div className="flex-none space-y-1">
            <h4 className="leading-none font-semibold">System Telemetry</h4>
            <p className="text-muted-foreground text-xs">
              Live resource usage (Last 30s)
            </p>
          </div>

          {currentMetrics ? (
            <Tabs
              defaultValue="system"
              className="flex min-h-0 w-full flex-1 flex-col"
            >
              <TabsList className="grid w-full flex-none grid-cols-2">
                <TabsTrigger value="system">System</TabsTrigger>
                <TabsTrigger value="gpu">GPU</TabsTrigger>
              </TabsList>
              <TabsContent
                value="system"
                className="grid min-h-0 gap-6 overflow-y-auto pt-4 pr-2"
              >
                {/* CPU Chart */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b pb-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-indigo-500" />
                      <span className="text-sm font-medium">CPU Usage</span>
                    </div>
                    <span className="font-mono text-xl font-bold tracking-tight">
                      {currentMetrics.cpu_percent}%
                    </span>
                  </div>
                  <div className="bg-muted/30 h-[100px] w-full rounded-lg border pt-2 pr-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={metricsHistory}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          vertical={false}
                          stroke="rgba(0,0,0,0.1)"
                        />
                        <YAxis domain={[0, 100]} hide />
                        <Tooltip
                          contentStyle={{
                            borderRadius: '8px',
                            fontSize: '12px',
                            border: 'none',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                          }}
                          itemStyle={{ color: '#6366f1' }}
                          labelStyle={{ display: 'none' }}
                          formatter={(value: number | undefined) => [
                            `${value ?? 0}%`,
                            'CPU',
                          ]}
                        />
                        <Line
                          type="monotone"
                          dataKey="cpu"
                          stroke="#6366f1"
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4, strokeWidth: 0 }}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Memory Chart */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b pb-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-emerald-500" />
                      <span className="text-sm font-medium">Memory Usage</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="font-mono text-xl font-bold tracking-tight">
                        {(
                          currentMetrics.used_memory /
                          1024 /
                          1024 /
                          1024
                        ).toFixed(1)}
                      </span>
                      <span className="text-muted-foreground text-xs font-medium">
                        / {totalMemoryGB} GB
                      </span>
                    </div>
                  </div>
                  <div className="bg-muted/30 h-[100px] w-full rounded-lg border pt-2 pr-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={metricsHistory}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          vertical={false}
                          stroke="rgba(0,0,0,0.1)"
                        />
                        <YAxis domain={[0, totalMemoryGB]} hide />
                        <Tooltip
                          contentStyle={{
                            borderRadius: '8px',
                            fontSize: '12px',
                            border: 'none',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                          }}
                          itemStyle={{ color: '#10b981' }}
                          labelStyle={{ display: 'none' }}
                          formatter={(value: number | undefined) => [
                            `${value ?? 0} GB`,
                            'Memory',
                          ]}
                        />
                        <Line
                          type="monotone"
                          dataKey="memory"
                          stroke="#10b981"
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4, strokeWidth: 0 }}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </TabsContent>

              <TabsContent
                value="gpu"
                className="min-h-0 space-y-6 overflow-y-auto pt-4 pr-2"
              >
                {/* GPU Charts */}
                {gpuIds.length === 0 ? (
                  <div className="text-muted-foreground py-8 text-center text-sm">
                    No GPUs detected
                  </div>
                ) : (
                  gpuIds.map((gpuId, index) => {
                    const gpuData = currentMetrics.gpus[gpuId]
                    // Assume GB as per observation
                    const gpuTotalGB = parseFloat(
                      gpuData.total_memory.toFixed(1),
                    )

                    const chartColor = index % 2 === 0 ? '#f97316' : '#e11d48' // Alternate colors: Orange vs Rose
                    const dotColor =
                      index % 2 === 0 ? 'bg-orange-500' : 'bg-rose-500'

                    return (
                      <div key={gpuId} className="space-y-3">
                        <div className="flex items-center justify-between border-b pb-2">
                          <div className="flex items-center gap-2">
                            <div
                              className={`h-2 w-2 rounded-full ${dotColor}`}
                            />
                            <span className="text-sm font-medium">
                              GPU ({gpuData.name || `GPU ${gpuId}`})
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          {/* Compute Chart */}
                          <div className="space-y-1">
                            <div className="flex items-baseline justify-between px-1">
                              <span className="text-muted-foreground text-xs font-medium">
                                Compute
                              </span>
                              <span
                                className={`font-mono text-lg font-bold tracking-tight ${
                                  index % 2 === 0
                                    ? 'text-orange-500'
                                    : 'text-rose-500'
                                }`}
                              >
                                {gpuData.compute_usage !== undefined
                                  ? `${gpuData.compute_usage.toFixed(1)}%`
                                  : '--'}
                              </span>
                            </div>
                            <div className="bg-muted/30 h-[100px] w-full rounded-lg border pt-2 pr-2">
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={metricsHistory}>
                                  <CartesianGrid
                                    strokeDasharray="3 3"
                                    vertical={false}
                                    stroke="rgba(0,0,0,0.1)"
                                  />
                                  <YAxis domain={[0, 100]} hide />
                                  <Tooltip
                                    contentStyle={{
                                      borderRadius: '8px',
                                      fontSize: '12px',
                                      border: 'none',
                                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                    }}
                                    itemStyle={{ color: chartColor }}
                                    labelStyle={{ display: 'none' }}
                                    formatter={(value: number | undefined) => [
                                      `${value ?? 0}%`,
                                      'Compute',
                                    ]}
                                  />
                                  <Line
                                    type="monotone"
                                    dataKey={`gpu_${gpuId}_util`}
                                    stroke={chartColor}
                                    strokeWidth={2}
                                    dot={false}
                                    activeDot={{ r: 4, strokeWidth: 0 }}
                                    isAnimationActive={false}
                                  />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                          {/* Memory Chart */}
                          <div className="space-y-1">
                            <div className="flex items-baseline justify-between px-1">
                              <span className="text-muted-foreground text-xs font-medium">
                                Memory
                              </span>
                              <div className="flex items-baseline gap-1">
                                <span
                                  className={`font-mono text-lg font-bold tracking-tight ${
                                    index % 2 === 0
                                      ? 'text-orange-500'
                                      : 'text-rose-500'
                                  }`}
                                >
                                  {gpuData.allocated_memory.toFixed(1)}
                                </span>
                                <span className="text-muted-foreground text-[10px] font-medium">
                                  / {gpuTotalGB} GB
                                </span>
                              </div>
                            </div>
                            <div className="bg-muted/30 h-[100px] w-full rounded-lg border pt-2 pr-2">
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={metricsHistory}>
                                  <CartesianGrid
                                    strokeDasharray="3 3"
                                    vertical={false}
                                    stroke="rgba(0,0,0,0.1)"
                                  />
                                  <YAxis domain={[0, gpuTotalGB]} hide />
                                  <Tooltip
                                    contentStyle={{
                                      borderRadius: '8px',
                                      fontSize: '12px',
                                      border: 'none',
                                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                    }}
                                    itemStyle={{ color: chartColor }}
                                    labelStyle={{ display: 'none' }}
                                    formatter={(value: number | undefined) => [
                                      `${value ?? 0} GB`,
                                      'Memory',
                                    ]}
                                  />
                                  <Line
                                    type="monotone"
                                    dataKey={`gpu_${gpuId}_allocated`}
                                    stroke={chartColor}
                                    strokeWidth={2}
                                    dot={false}
                                    activeDot={{ r: 4, strokeWidth: 0 }}
                                    isAnimationActive={false}
                                  />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="bg-muted/30 flex justify-between rounded border p-2">
                            <span className="text-muted-foreground">Power</span>
                            <span className="font-mono font-medium">
                              {gpuData.power !== undefined
                                ? `${gpuData.power.toFixed(1)} W`
                                : '--'}
                            </span>
                          </div>
                          <div className="bg-muted/30 flex justify-between rounded border p-2">
                            <span className="text-muted-foreground">Freq</span>
                            <span className="font-mono font-medium">
                              {gpuData.frequency !== undefined
                                ? `${gpuData.frequency} MHz`
                                : '--'}
                            </span>
                          </div>
                          <div className="bg-muted/30 flex justify-between rounded border p-2">
                            <span className="text-muted-foreground">
                              Mem Util
                            </span>
                            <span className="font-mono font-medium">
                              {gpuData.memory_utilization !== undefined
                                ? `${gpuData.memory_utilization.toFixed(1)}%`
                                : '--'}
                            </span>
                          </div>
                          <div className="bg-muted/30 flex justify-between rounded border p-2">
                            <span className="text-muted-foreground">
                              Media Freq
                            </span>
                            <span className="font-mono font-medium">
                              {gpuData.media_engine_frequency !== undefined
                                ? `${gpuData.media_engine_frequency} MHz`
                                : '--'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </TabsContent>
            </Tabs>
          ) : (
            <div className="text-muted-foreground flex h-[280px] flex-col items-center justify-center space-y-3">
              <Loader2 className="text-primary h-8 w-8 animate-spin" />
              <p className="text-sm font-medium">Connecting to system...</p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
