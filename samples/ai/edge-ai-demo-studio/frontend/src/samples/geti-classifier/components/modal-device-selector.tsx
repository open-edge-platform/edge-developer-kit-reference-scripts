// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  AlertTriangle,
  Box,
  Database,
  Gauge,
  RefreshCw,
  Star,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useAvailableDevices } from '../hooks'
import type { GetiModel } from '../hooks'
import { DeviceIcon, deviceDescription, getDeviceColor } from './device-utils'

interface ModelDeviceSelectorProps {
  phase: 'seg' | 'cls'
  models: GetiModel[]
  selectedModelId: string
  onModelChange: (id: string) => void
  selectedDevice: string
  onDeviceChange: (device: string) => void
  onSetupReset: () => void
}

export function ModelDeviceSelector({
  models,
  selectedModelId,
  onModelChange,
  selectedDevice,
  onDeviceChange,
  onSetupReset,
}: ModelDeviceSelectorProps) {
  const {
    availableDevices,
    isLoading: devicesLoading,
    isError: devicesError,
    isFetching,
    refetch: refetchDevices,
  } = useAvailableDevices()

  return (
    <div className="grid gap-5 md:grid-cols-2">
      {/* ── Model version ──────────────────────────────────────────────── */}
      <div className="space-y-2">
        <Label className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
          <Database className="h-3 w-3" />
          Model Version
        </Label>
        <Select
          value={selectedModelId}
          onValueChange={(val) => {
            onModelChange(val)
            onSetupReset()
          }}
        >
          <SelectTrigger className="bg-background border-2 transition-colors">
            <SelectValue placeholder="Select a model..." />
          </SelectTrigger>
          <SelectContent>
            {/* Always-present "latest" option */}
            <SelectItem value="latest">
              <div className="flex items-center gap-2.5">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50">
                  <Star className="h-3 w-3 text-amber-500" />
                </div>
                <div className="flex flex-col items-start">
                  <span className="text-sm font-medium">
                    Latest Active Model
                  </span>
                  <span className="text-muted-foreground text-xs">
                    Always use the most recent trained model
                  </span>
                </div>
              </div>
            </SelectItem>

            {/* Specific model versions from the project */}
            {models.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                <div className="flex items-center gap-2.5">
                  <div className="bg-muted flex h-6 w-6 items-center justify-center rounded-full">
                    <Box className="text-muted-foreground h-3 w-3" />
                  </div>
                  <div className="flex flex-col items-start">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium">
                        {m.name} v{m.version ?? '?'}
                      </span>
                      {m.is_active && (
                        <Badge className="h-4 border-0 bg-green-100 px-1 text-[10px] text-green-700">
                          active
                        </Badge>
                      )}
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {m.score != null
                        ? `score ${(m.score * 100).toFixed(1)}%`
                        : 'no score'}
                      {m.precision?.length > 0
                        ? ` · ${m.precision.join('/')}`
                        : ''}
                      {m.creation_date
                        ? ` · ${new Date(m.creation_date).toLocaleDateString()}`
                        : ''}
                    </span>
                  </div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Inference device ───────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
            <Gauge className="h-3 w-3" />
            Inference Device
          </Label>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground h-5 gap-1 px-1.5 text-[10px]"
            onClick={() => void refetchDevices()}
            disabled={isFetching}
          >
            <RefreshCw
              className={cn('h-3 w-3', isFetching && 'animate-spin')}
            />
            Refresh
          </Button>
        </div>

        {devicesLoading ? (
          <div className="bg-muted/30 text-muted-foreground flex h-10 items-center gap-2 rounded-md border px-3 text-sm">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            Detecting devices...
          </div>
        ) : (
          <Select
            value={selectedDevice}
            onValueChange={(val) => {
              onDeviceChange(val)
              onSetupReset()
            }}
          >
            <SelectTrigger className="bg-background border-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableDevices.map((d) => (
                <SelectItem key={d.name} value={d.name}>
                  <div className="flex items-center gap-2.5">
                    <div
                      className={cn(
                        'flex h-6 w-6 items-center justify-center rounded-full border',
                        getDeviceColor(d.type),
                      )}
                    >
                      <DeviceIcon type={d.type} className="h-3 w-3" />
                    </div>
                    <div className="flex flex-col items-start">
                      <span className="text-sm font-medium">{d.name}</span>
                      <span className="text-muted-foreground max-w-[180px] truncate text-xs">
                        {d.full_name !== d.name
                          ? d.full_name
                          : deviceDescription(d.type)}
                      </span>
                    </div>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {devicesError && (
          <p className="text-muted-foreground flex items-center gap-1 text-xs">
            <AlertTriangle className="h-3 w-3 text-amber-500" />
            Worker offline — showing defaults
          </p>
        )}
      </div>
    </div>
  )
}
