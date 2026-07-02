// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Cpu, Globe, Mic } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { useDevicesQuery, resolveDeviceOptions } from '@/hooks/use-devices'
import { useUpdateServiceConfig } from '@/hooks/use-service-config'
import { ClearModelCacheSection } from '@/services/common/demo/components/clear-model-cache-section'
import {
  type ConfigurePanelStatus,
  ServiceConfigurePanel,
} from '@/components/common/service-configure-panel'
import {
  type Service,
  getBackendForModel,
  getDevicesForModel,
} from '@/services/types'
import { getLanguagesForModel, getVoicesForModel } from '../config'

interface TtsConfigurePanelProps {
  service: Service
}

export function TtsConfigurePanel({ service }: TtsConfigurePanelProps) {
  const currentModel =
    service.currentModel ?? service.defaultModel?.name ?? 'kokoro'
  const currentDevice =
    service.currentDevice ?? service.defaultModel?.device ?? 'CPU'

  const [open, setOpen] = useState(false)
  const [draftModel, setDraftModel] = useState(currentModel)
  const [draftDevice, setDraftDevice] = useState(currentDevice)

  const { mutate: updateConfig, isPending: isSaving } = useUpdateServiceConfig()

  const availableModels = service.config?.availableModels ?? []
  const availableDevices = getDevicesForModel(service.config, draftModel)

  const resolvedBackend = useMemo(
    () => getBackendForModel(service.config, draftModel),
    [service.config, draftModel],
  )
  const { data: backendDevices, isError: isDeviceError } =
    useDevicesQuery(resolvedBackend)

  const deviceList = useMemo(
    () =>
      resolveDeviceOptions(availableDevices, backendDevices, resolvedBackend),
    [availableDevices, backendDevices, resolvedBackend],
  )

  // Read-only voice/language info for the draft model
  const languages = useMemo(
    () => getLanguagesForModel(draftModel),
    [draftModel],
  )
  const voices = useMemo(() => getVoicesForModel(draftModel), [draftModel])

  const voicesByLanguage = useMemo(() => {
    const counts = new Map<string, number>()
    for (const v of voices) {
      counts.set(v.language, (counts.get(v.language) ?? 0) + 1)
    }
    return Array.from(counts, ([language, count]) => ({ language, count }))
  }, [voices])

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setDraftModel(currentModel)
        setDraftDevice(currentDevice)
      }
      setOpen(newOpen)
    },
    [currentModel, currentDevice],
  )

  const isDirty =
    draftModel !== currentModel ||
    draftDevice.toLowerCase() !== currentDevice.toLowerCase()

  const handleCancel = useCallback(() => {
    setDraftModel(currentModel)
    setDraftDevice(currentDevice)
  }, [currentModel, currentDevice])

  const handleSave = useCallback(() => {
    if (!service.dbId) return

    updateConfig(
      {
        serviceId: service.dbId,
        serviceType: service.id,
        config: {
          name: draftModel,
          device: draftDevice,
        },
      },
      { onSuccess: () => setOpen(false) },
    )
  }, [service.dbId, service.id, draftModel, draftDevice, updateConfig])

  const statusItems: ConfigurePanelStatus[] = [
    { label: 'Current model', value: currentModel || '—' },
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
          Model
        </p>
        <div className="space-y-2">
          <Label
            htmlFor="tts-cfg-model"
            className="text-muted-foreground text-xs"
          >
            Model
          </Label>
          <Select value={draftModel} onValueChange={setDraftModel}>
            <SelectTrigger
              data-testid="tts-cfg-model"
              id="tts-cfg-model"
              className="w-full text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableModels.map((m) => (
                <SelectItem key={m.value} value={m.value} className="text-xs">
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Separator />

      <div className="space-y-3 px-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Available Voices
        </p>
        <p className="text-muted-foreground text-xs">
          Language and voice can be configured in the demo panel at runtime.
        </p>
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <Globe className="h-3 w-3 shrink-0" />
          <span>
            {languages.length} language{languages.length !== 1 ? 's' : ''}
          </span>
          <span className="text-muted-foreground/50">·</span>
          <Mic className="h-3 w-3 shrink-0" />
          <span>
            {voices.length} voice{voices.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="divide-border max-h-44 divide-y overflow-y-auto rounded-md border">
          {voicesByLanguage.map(({ language, count }) => (
            <div
              key={language}
              className="flex items-center justify-between gap-2 px-2.5 py-1.5"
            >
              <span className="truncate text-xs">{language}</span>
              <Badge
                variant="secondary"
                className="shrink-0 text-[10px] tabular-nums"
              >
                {count} voice{count !== 1 ? 's' : ''}
              </Badge>
            </div>
          ))}
        </div>
      </div>

      <Separator />

      <div className="space-y-3 px-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Accelerator
        </p>
        <div className="space-y-2">
          <Label
            htmlFor="cfg-device-select"
            className="text-muted-foreground text-xs"
          >
            <Cpu className="mr-1 inline-block h-3 w-3" />
            Device
          </Label>
          <Select value={draftDevice} onValueChange={setDraftDevice}>
            <SelectTrigger
              data-testid="cfg-device-select"
              id="cfg-device-select"
              className="w-full text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {deviceList.map((d) => (
                <SelectItem
                  key={d.value}
                  value={d.value}
                  textValue={d.value}
                  className="text-xs"
                >
                  <span>{d.value}</span>
                  {d.value !== d.label && (
                    <span className="text-muted-foreground font-normal">
                      {d.label}
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isDeviceError && (
            <p className="text-destructive text-[10px]">
              Failed to fetch GPU devices. Check that the helper service is
              running.
            </p>
          )}
        </div>
      </div>

      <Separator />

      <ClearModelCacheSection service={service} />
    </ServiceConfigurePanel>
  )
}
