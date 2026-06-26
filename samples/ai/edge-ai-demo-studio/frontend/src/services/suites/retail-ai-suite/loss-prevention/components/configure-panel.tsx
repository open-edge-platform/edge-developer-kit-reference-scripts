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
const HETERO_VALUE = 'HETERO'
const MODEL_NAME = 'loss-prevention'

function matchesSupportedDevice(deviceValue: string): boolean {
  const upper = deviceValue.toUpperCase()
  return SUPPORTED_DEVICES.some((s) => upper === s || upper.startsWith(`${s}.`))
}

interface LpConfigurePanelProps {
  service: Service
}

export function LpConfigurePanel({ service }: LpConfigurePanelProps) {
  const currentDevice =
    service.currentDevice ?? service.defaultModel?.device ?? 'CPU'
  const currentMeta = service.metadata as Record<string, unknown> | undefined
  const baseDevice = currentDevice === HETERO_VALUE ? 'CPU' : currentDevice
  const currentDetectDevice = String(currentMeta?.detectDevice ?? baseDevice)
  const currentClassifyDevice = String(
    currentMeta?.classifyDevice ?? baseDevice,
  )

  const [open, setOpen] = useState(false)
  const [draftDevice, setDraftDevice] = useState(currentDevice)
  const [draftDetectDevice, setDraftDetectDevice] =
    useState(currentDetectDevice)
  const [draftClassifyDevice, setDraftClassifyDevice] = useState(
    currentClassifyDevice,
  )

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

  const allOptions = useMemo(
    () => [
      ...deviceOptions,
      { value: HETERO_VALUE, label: 'HETERO (per-model)' },
    ],
    [deviceOptions],
  )

  const isHetero = draftDevice === HETERO_VALUE

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setDraftDevice(currentDevice)
        setDraftDetectDevice(currentDetectDevice)
        setDraftClassifyDevice(currentClassifyDevice)
      }
      setOpen(newOpen)
    },
    [currentDevice, currentDetectDevice, currentClassifyDevice],
  )

  const isDirty = useMemo(() => {
    if (draftDevice.toLowerCase() !== currentDevice.toLowerCase()) return true
    if (isHetero) {
      return (
        draftDetectDevice !== currentDetectDevice ||
        draftClassifyDevice !== currentClassifyDevice
      )
    }
    return false
  }, [
    draftDevice,
    draftDetectDevice,
    draftClassifyDevice,
    currentDevice,
    currentDetectDevice,
    currentClassifyDevice,
    isHetero,
  ])

  const handleCancel = useCallback(() => {
    setDraftDevice(currentDevice)
    setDraftDetectDevice(currentDetectDevice)
    setDraftClassifyDevice(currentClassifyDevice)
  }, [currentDevice, currentDetectDevice, currentClassifyDevice])

  const handleSave = useCallback(() => {
    if (!service.dbId) return
    if (isHetero) {
      updateConfig(
        {
          serviceId: service.dbId,
          serviceType: service.id,
          config: {
            name: MODEL_NAME,
            device: HETERO_VALUE,
            metadata: {
              detectDevice: draftDetectDevice,
              classifyDevice: draftClassifyDevice,
            },
          },
        },
        { onSuccess: () => setOpen(false) },
      )
    } else {
      updateConfig(
        {
          serviceId: service.dbId,
          serviceType: service.id,
          config: {
            name: MODEL_NAME,
            device: draftDevice,
            metadata: {},
          },
        },
        { onSuccess: () => setOpen(false) },
      )
    }
  }, [
    service.dbId,
    service.id,
    draftDevice,
    draftDetectDevice,
    draftClassifyDevice,
    isHetero,
    updateConfig,
  ])

  const currentDeviceDisplay =
    currentDevice === HETERO_VALUE
      ? `Detect: ${currentDetectDevice} / Classify: ${currentClassifyDevice}`
      : currentDevice || '—'

  const statusItems: ConfigurePanelStatus[] = [
    { label: 'Current device', value: currentDeviceDisplay },
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
            htmlFor="lp-cfg-device"
            className="text-muted-foreground text-xs"
          >
            Device
          </Label>
          <Select value={draftDevice} onValueChange={setDraftDevice}>
            <SelectTrigger
              id="lp-cfg-device"
              data-testid="cfg-device-select"
              className="w-full text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allOptions.map((d) => (
                <SelectItem key={d.value} value={d.value} className="text-xs">
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isHetero && (
          <div className="border-border space-y-3 border-l pl-2">
            <div className="space-y-2">
              <Label
                htmlFor="lp-cfg-detect-device"
                className="text-muted-foreground text-xs"
              >
                Detection device (YOLO11n)
              </Label>
              <Select
                value={draftDetectDevice}
                onValueChange={setDraftDetectDevice}
              >
                <SelectTrigger
                  id="lp-cfg-detect-device"
                  data-testid="cfg-detect-device-select"
                  className="w-full text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {deviceOptions.map((d) => (
                    <SelectItem
                      key={d.value}
                      value={d.value}
                      className="text-xs"
                    >
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="lp-cfg-classify-device"
                className="text-muted-foreground text-xs"
              >
                Classification device (EfficientNet-B0)
              </Label>
              <Select
                value={draftClassifyDevice}
                onValueChange={setDraftClassifyDevice}
              >
                <SelectTrigger
                  id="lp-cfg-classify-device"
                  data-testid="cfg-classify-device-select"
                  className="w-full text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {deviceOptions.map((d) => (
                    <SelectItem
                      key={d.value}
                      value={d.value}
                      className="text-xs"
                    >
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>
    </ServiceConfigurePanel>
  )
}
