// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Cpu, Upload } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { useDevicesQuery, resolveDeviceOptions } from '@/hooks/use-devices'
import { useUpdateServiceConfig } from '@/hooks/use-service-config'
import {
  type ModelSource,
  type Service,
  getBackendForModel,
  getDevicesForModel,
} from '@/services/types'
import { ClearModelCacheSection } from './clear-model-cache-section'
import {
  type ConfigurePanelStatus,
  ServiceConfigurePanel,
} from './service-configure-panel'

interface WorkerConfigurePanelProps {
  service: Service
}

function isModelSource(value: string): value is ModelSource {
  return value === 'huggingface' || value === 'modelscope'
}

export function WorkerConfigurePanel({ service }: WorkerConfigurePanelProps) {
  const availableModels = useMemo(
    () => service.config?.availableModels ?? [],
    [service.config?.availableModels],
  )
  const availableSources = service.config?.availableModelSources ?? []
  const supportsCustomModel = service.config?.supportsCustomModel !== false

  const currentModel = service.currentModel ?? service.defaultModel?.name ?? ''
  const currentDevice =
    service.currentDevice ?? service.defaultModel?.device ?? ''

  const [open, setOpen] = useState(false)
  const [sourceType, setSourceType] = useState<'preset' | 'custom'>('preset')
  const [draftModel, setDraftModel] = useState(currentModel)
  const [customModel, setCustomModel] = useState('')
  const [draftDevice, setDraftDevice] = useState(currentDevice)
  const currentSource = service.currentSource ?? 'huggingface'
  const [draftSource, setDraftSource] = useState(currentSource)

  const availableDevices = useMemo(
    () => getDevicesForModel(service.config, draftModel),
    [service.config, draftModel],
  )

  const resolvedBackend = useMemo(
    () => getBackendForModel(service.config, draftModel),
    [service.config, draftModel],
  )
  const { data: backendDevices } = useDevicesQuery(resolvedBackend)

  const { mutate: updateConfig, isPending: isSaving } = useUpdateServiceConfig()

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      const isCustom =
        supportsCustomModel &&
        !availableModels.some((m) => m.value === currentModel)
      setSourceType(isCustom ? 'custom' : 'preset')
      setCustomModel(isCustom ? currentModel : '')
      // In custom mode, keep draftModel pointing at a valid preset so the
      // backend device query remains enabled.  resolvedModel still reads from
      // customModel when sourceType === 'custom'.
      setDraftModel(
        isCustom ? (availableModels[0]?.value ?? currentModel) : currentModel,
      )
      setDraftDevice(currentDevice)
      setDraftSource(currentSource)
      setOpen(newOpen)
    },
    [
      currentModel,
      currentDevice,
      currentSource,
      availableModels,
      supportsCustomModel,
    ],
  )

  // Resolve device options: enrich static device values with labels from API
  const deviceOptions = useMemo(
    () =>
      resolveDeviceOptions(availableDevices, backendDevices, resolvedBackend),
    [availableDevices, backendDevices, resolvedBackend],
  )

  const selectedDeviceOption = deviceOptions.find(
    (d) => d.value.toLowerCase() === draftDevice.toLowerCase(),
  )
  const selectedDeviceValue = selectedDeviceOption?.value ?? draftDevice

  const resolvedModel =
    sourceType === 'custom' ? customModel.trim() : draftModel

  const isDirty =
    open &&
    (resolvedModel !== currentModel ||
      draftDevice.toLowerCase() !== currentDevice.toLowerCase() ||
      draftSource !== currentSource)

  const isValid = resolvedModel.length > 0

  const handleCancel = useCallback(() => {
    const isCustom =
      supportsCustomModel &&
      !availableModels.some((m) => m.value === currentModel)
    setSourceType(isCustom ? 'custom' : 'preset')
    setCustomModel(isCustom ? currentModel : '')
    setDraftModel(
      isCustom ? (availableModels[0]?.value ?? currentModel) : currentModel,
    )
    setDraftDevice(currentDevice)
    setDraftSource(currentSource)
  }, [
    currentModel,
    currentDevice,
    currentSource,
    availableModels,
    supportsCustomModel,
  ])

  const handleSave = useCallback(() => {
    if (!service.dbId || !isValid) return

    updateConfig(
      {
        serviceId: service.dbId,
        serviceType: service.id,
        config: {
          name: resolvedModel,
          device: selectedDeviceValue,
          ...(availableSources.length > 0 ? { source: draftSource } : {}),
        },
      },
      { onSuccess: () => setOpen(false) },
    )
  }, [
    service.dbId,
    service.id,
    resolvedModel,
    selectedDeviceValue,
    availableSources.length,
    draftSource,
    isValid,
    updateConfig,
  ])

  const statusItems: ConfigurePanelStatus[] = [
    { label: 'Current model', value: currentModel || '—' },
    { label: 'Current device', value: currentDevice || '—' },
  ]

  return (
    <ServiceConfigurePanel
      serviceName={service.name}
      statusItems={statusItems}
      isDirty={isDirty}
      isValid={isValid}
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

        {supportsCustomModel ? (
          <div className="grid grid-cols-2 gap-2">
            <Button
              data-testid="source-preset-button"
              type="button"
              size="sm"
              variant={sourceType === 'preset' ? 'default' : 'outline'}
              onClick={() => setSourceType('preset')}
            >
              Preset
            </Button>
            <Button
              data-testid="source-custom-button"
              type="button"
              size="sm"
              variant={sourceType === 'custom' ? 'default' : 'outline'}
              onClick={() => setSourceType('custom')}
            >
              Custom
            </Button>
          </div>
        ) : null}

        {sourceType === 'preset' && availableModels.length > 0 && (
          <div className="space-y-2">
            <Label
              htmlFor="cfg-model-select"
              className="text-muted-foreground text-xs"
            >
              Model
            </Label>
            <Select value={draftModel} onValueChange={setDraftModel}>
              <SelectTrigger
                data-testid="cfg-model-select"
                id="cfg-model-select"
                className="w-full text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableModels.map((m) => (
                  <SelectItem key={m.value} value={m.value} className="text-xs">
                    {m.value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {sourceType === 'custom' && (
          <div className="space-y-2">
            <Label
              htmlFor="cfg-custom-model"
              className="text-muted-foreground text-xs"
            >
              <Upload className="mr-1 inline-block h-3 w-3" />
              Model ID (e.g. org/model-name)
            </Label>
            <Input
              id="cfg-custom-model"
              data-testid="cfg-custom-model"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              placeholder="openai/whisper-large-v3"
              className="text-xs"
            />
          </div>
        )}

        {availableSources.length > 0 && (
          <div className="space-y-2">
            <Label
              htmlFor="cfg-source-select"
              className="text-muted-foreground text-xs"
            >
              Source
            </Label>
            <div
              id="cfg-source-select"
              data-testid="cfg-source-select"
              role="group"
              aria-label="Model source"
              className="flex flex-wrap gap-1.5"
            >
              {availableSources.map((s) => {
                const isSelected = draftSource === s.value
                return (
                  <Button
                    key={s.value}
                    type="button"
                    size="sm"
                    variant={isSelected ? 'default' : 'outline'}
                    onClick={() => {
                      if (isModelSource(s.value)) {
                        setDraftSource(s.value)
                      }
                    }}
                    className={cn(
                      'h-7 px-3 text-xs transition-all',
                      isSelected && 'ring-ring ring-1 ring-offset-0',
                    )}
                  >
                    {s.label}
                  </Button>
                )
              })}
            </div>
          </div>
        )}
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
          <Select value={selectedDeviceValue} onValueChange={setDraftDevice}>
            <SelectTrigger
              data-testid="cfg-device-select"
              id="cfg-device-select"
              className="w-full text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {deviceOptions.map((d) => (
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
        </div>
      </div>

      <Separator />

      <ClearModelCacheSection service={service} />
    </ServiceConfigurePanel>
  )
}
