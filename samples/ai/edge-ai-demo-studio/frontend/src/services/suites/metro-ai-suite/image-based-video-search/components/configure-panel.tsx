// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback, useMemo, useState } from 'react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useDevicesQuery } from '@/hooks/use-devices'
import { useUpdateServiceConfig } from '@/hooks/use-service-config'
import {
  type ConfigurePanelStatus,
  ServiceConfigurePanel,
} from '@/components/common/service-configure-panel'
import type { Service } from '@/services/types'

const SUPPORTED_DEVICES = ['CPU', 'GPU', 'NPU']
const MODEL_NAME = 'image-based-video-search'

function matchesSupportedDevice(deviceValue: string): boolean {
  const upper = deviceValue.toUpperCase()
  return SUPPORTED_DEVICES.some((s) => upper === s || upper.startsWith(`${s}.`))
}

interface IbvsConfigurePanelProps {
  service: Service
}

export function IbvsConfigurePanel({ service }: IbvsConfigurePanelProps) {
  const currentDevice =
    service.currentDevice ?? service.defaultModel?.device ?? 'CPU'

  const [open, setOpen] = useState(false)
  const [draftDevice, setDraftDevice] = useState(currentDevice)

  const { mutate: updateConfig, isPending: isSaving } = useUpdateServiceConfig()
  const { data: openvinoDevices = [] } = useDevicesQuery('openvino')

  const deviceOptions = useMemo(() => {
    const filtered = openvinoDevices.filter((d) =>
      matchesSupportedDevice(d.value),
    )
    return filtered.length > 0
      ? filtered
      : SUPPORTED_DEVICES.map((d) => ({ value: d, label: d }))
  }, [openvinoDevices])

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) setDraftDevice(currentDevice)
      setOpen(newOpen)
    },
    [currentDevice],
  )

  const isDirty = draftDevice.toLowerCase() !== currentDevice.toLowerCase()

  const handleCancel = useCallback(() => {
    setDraftDevice(currentDevice)
  }, [currentDevice])

  const handleSave = useCallback(() => {
    if (!service.dbId) return
    updateConfig(
      {
        serviceId: service.dbId,
        serviceType: service.id,
        config: { name: MODEL_NAME, device: draftDevice },
      },
      { onSuccess: () => setOpen(false) },
    )
  }, [service.dbId, service.id, draftDevice, updateConfig])

  const statusItems: ConfigurePanelStatus[] = [
    { label: 'Current device', value: currentDevice || '—' },
  ]

  return (
    <ServiceConfigurePanel
      serviceName={service.name}
      statusItems={statusItems}
      isDirty={isDirty}
      isValid={true}
      onSave={handleSave}
      isSaving={isSaving}
      onCancel={handleCancel}
      open={open}
      onOpenChange={handleOpenChange}
    >
      <div className="space-y-3 px-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Accelerator
        </p>
        <div className="space-y-2">
          <Label
            htmlFor="ibvs-cfg-device"
            className="text-muted-foreground text-xs"
          >
            Device
          </Label>
          <Select value={draftDevice} onValueChange={setDraftDevice}>
            <SelectTrigger
              id="ibvs-cfg-device"
              data-testid="ibvs-cfg-device"
              className="w-full text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {deviceOptions.map((d) => (
                <SelectItem key={d.value} value={d.value} className="text-xs">
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-[11px]">
            Takes effect on next service start. Configures the YOLOv11s and
            ResNet-50 detection pipeline.
          </p>
        </div>
      </div>
    </ServiceConfigurePanel>
  )
}
