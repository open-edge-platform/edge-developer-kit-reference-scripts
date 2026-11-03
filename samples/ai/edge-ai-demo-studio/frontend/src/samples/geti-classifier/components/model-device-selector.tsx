// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Box, Database, Gauge, Star } from 'lucide-react'
import { DeviceSelect } from '@/components/configure/device-select'
import { TONES } from '@/components/common/tones'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useServiceApiBase } from '@/context/service-status-context'
import { cn } from '@/lib/utils'
import { useAvailableDevices } from '../hooks/use-devices'
import type { PhaseSetup } from '../hooks/use-phase-setup'
import { deviceDescription, formatModelVersion } from '../lib/format'

/** The model version to deploy (latest active, or a specific one) and its device. */
export function ModelDeviceSelector({ setup }: { setup: PhaseSetup }) {
  const apiBase = useServiceApiBase('geti-classifier')
  const devices = useAvailableDevices(apiBase)

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div className="space-y-2">
        <Label
          htmlFor="geti-model-version"
          className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase"
        >
          <Database className="h-3 w-3" aria-hidden />
          Model Version
        </Label>
        <Select value={setup.selectedModelId} onValueChange={setup.setModel}>
          <SelectTrigger
            id="geti-model-version"
            className="bg-background w-full border-2 transition-colors"
          >
            <SelectValue placeholder="Select a model..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="latest" textValue="Latest Active Model">
              <div className="flex items-center gap-2.5">
                <div
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full',
                    TONES.warning.iconBg,
                  )}
                >
                  <Star className="h-3 w-3" aria-hidden />
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

            {setup.models.map((m) => (
              <SelectItem
                key={m.id}
                value={m.id}
                textValue={formatModelVersion(m)}
              >
                <div className="flex items-center gap-2.5">
                  <div className="bg-muted flex h-6 w-6 items-center justify-center rounded-full">
                    <Box
                      className="text-muted-foreground h-3 w-3"
                      aria-hidden
                    />
                  </div>
                  <div className="flex flex-col items-start">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium">
                        {formatModelVersion(m)}
                      </span>
                      {m.is_active && (
                        <Badge tone="success" className="h-4 px-1 text-[10px]">
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

      <DeviceSelect
        value={setup.selectedDevice}
        onValueChange={setup.setDevice}
        options={devices.availableDevices.map((d) => ({
          value: d.name,
          label:
            d.full_name !== d.name ? d.full_name : deviceDescription(d.type),
        }))}
        isLoading={devices.isLoading}
        isError={devices.isError}
        onRetry={() => void devices.refetch()}
        testId="geti-device-select"
        label={
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
            <Gauge className="h-3 w-3" aria-hidden />
            Inference Device
          </span>
        }
      />
    </div>
  )
}
