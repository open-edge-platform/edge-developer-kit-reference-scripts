// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Cpu, Network, Upload } from 'lucide-react'
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
import { useDevicesQuery, resolveDeviceOptions } from '@/hooks/use-devices'
import { useUpdateServiceConfig } from '@/hooks/use-service-config'
import { ClearModelCacheSection } from '@/services/common/demo/components/clear-model-cache-section'
import {
  type ConfigurePanelStatus,
  ServiceConfigurePanel,
} from '@/services/common/demo/components/service-configure-panel'
import {
  type Service,
  getBackendForModel,
  getDevicesForModel,
  isDeviceMatch,
} from '@/services/types'

interface LipsyncConfigurePanelProps {
  service: Service
}

export function LipsyncConfigurePanel({ service }: LipsyncConfigurePanelProps) {
  const availableModels = service.config?.availableModels ?? []
  const availableSources = service.config?.availableModelSources ?? []
  const supportsCustomModel = service.config?.supportsCustomModel !== false

  const currentModel = service.currentModel ?? service.defaultModel?.name ?? ''
  const currentDevice =
    service.currentDevice ?? service.defaultModel?.device ?? ''
  const currentClientIceServerUrl =
    (service.metadata as { clientIceServerUrl?: string } | undefined)
      ?.clientIceServerUrl ?? ''
  const currentServerIceServerUrl =
    (service.metadata as { serverIceServerUrl?: string } | undefined)
      ?.serverIceServerUrl ?? ''

  const [open, setOpen] = useState(false)
  const [sourceType, setSourceType] = useState<'preset' | 'custom'>('preset')
  const [draftModel, setDraftModel] = useState(currentModel)
  const [customModel, setCustomModel] = useState('')
  const [draftDevice, setDraftDevice] = useState(currentDevice)
  const [draftSource, setDraftSource] = useState('huggingface')
  const [draftClientIceServerUrl, setDraftClientIceServerUrl] = useState(
    currentClientIceServerUrl,
  )
  const [draftServerIceServerUrl, setDraftServerIceServerUrl] = useState(
    currentServerIceServerUrl,
  )

  const availableDevices = useMemo(
    () => getDevicesForModel(service.config, draftModel),
    [service.config, draftModel],
  )

  const resolvedBackend = useMemo(
    () => getBackendForModel(service.config, draftModel),
    [service.config, draftModel],
  )
  const { data: backendDevices, isError: isDeviceError } =
    useDevicesQuery(resolvedBackend)

  const { mutate: updateConfig, isPending: isSaving } = useUpdateServiceConfig()

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (newOpen) {
        setDraftModel(currentModel)
        setDraftDevice(currentDevice)
        setDraftClientIceServerUrl(currentClientIceServerUrl)
        setDraftServerIceServerUrl(currentServerIceServerUrl)
      } else {
        setDraftModel(currentModel)
        setDraftDevice(currentDevice)
        setDraftClientIceServerUrl(currentClientIceServerUrl)
        setDraftServerIceServerUrl(currentServerIceServerUrl)
        setCustomModel('')
        setSourceType('preset')
      }
      setOpen(newOpen)
    },
    [
      currentModel,
      currentDevice,
      currentClientIceServerUrl,
      currentServerIceServerUrl,
    ],
  )

  // Resolve device options: enrich static device values with labels from API
  const deviceOptions = useMemo(
    () =>
      resolveDeviceOptions(availableDevices, backendDevices, resolvedBackend),
    [availableDevices, backendDevices, resolvedBackend],
  )

  const selectedDeviceOption = deviceOptions.find((d) =>
    isDeviceMatch(draftDevice, d.value, resolvedBackend),
  )
  const selectedDeviceValue = selectedDeviceOption?.value ?? draftDevice

  const resolvedModel =
    sourceType === 'custom' ? customModel.trim() : draftModel

  const isDirty =
    open &&
    (resolvedModel !== currentModel ||
      draftDevice.toLowerCase() !== currentDevice.toLowerCase() ||
      draftClientIceServerUrl !== currentClientIceServerUrl ||
      draftServerIceServerUrl !== currentServerIceServerUrl)

  const isValid = resolvedModel.length > 0

  const handleCancel = useCallback(() => {
    setDraftModel(currentModel)
    setDraftDevice(currentDevice)
    setDraftClientIceServerUrl(currentClientIceServerUrl)
    setDraftServerIceServerUrl(currentServerIceServerUrl)
    setCustomModel('')
    setSourceType('preset')
  }, [
    currentModel,
    currentDevice,
    currentClientIceServerUrl,
    currentServerIceServerUrl,
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
          ...(sourceType === 'custom' && draftSource !== 'huggingface'
            ? { source: draftSource }
            : {}),
          metadata: {
            clientIceServerUrl: draftClientIceServerUrl || null,
            serverIceServerUrl: draftServerIceServerUrl || null,
          },
        },
      },
      { onSuccess: () => setOpen(false) },
    )
  }, [
    service.dbId,
    service.id,
    resolvedModel,
    selectedDeviceValue,
    draftSource,
    sourceType,
    draftClientIceServerUrl,
    draftServerIceServerUrl,
    isValid,
    updateConfig,
  ])

  const statusItems: ConfigurePanelStatus[] = [
    { label: 'Current model', value: currentModel || '—' },
    { label: 'Current device', value: currentDevice || '—' },
    {
      label: 'Client ICE server',
      value: currentClientIceServerUrl || 'None',
    },
    {
      label: 'Server ICE server',
      value: currentServerIceServerUrl || 'None',
    },
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
              type="button"
              size="sm"
              variant={sourceType === 'preset' ? 'secondary' : 'outline'}
              onClick={() => setSourceType('preset')}
            >
              Preset
            </Button>
            <Button
              type="button"
              size="sm"
              variant={sourceType === 'custom' ? 'secondary' : 'outline'}
              onClick={() => setSourceType('custom')}
            >
              Custom
            </Button>
          </div>
        ) : null}

        {sourceType === 'preset' && availableModels.length > 0 && (
          <div className="space-y-2">
            <Label
              htmlFor="ls-cfg-model-select"
              className="text-muted-foreground text-xs"
            >
              Model
            </Label>
            <Select value={draftModel} onValueChange={setDraftModel}>
              <SelectTrigger
                id="ls-cfg-model-select"
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
        )}

        {sourceType === 'custom' && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label
                htmlFor="ls-cfg-custom-model"
                className="text-muted-foreground text-xs"
              >
                <Upload className="mr-1 inline-block h-3 w-3" />
                Model ID (e.g. org/model-name)
              </Label>
              <Input
                id="ls-cfg-custom-model"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="Wav2lip"
                className="text-xs"
              />
            </div>

            {availableSources.length > 0 && (
              <div className="space-y-2">
                <Label
                  htmlFor="ls-cfg-source-select"
                  className="text-muted-foreground text-xs"
                >
                  Source
                </Label>
                <Select value={draftSource} onValueChange={setDraftSource}>
                  <SelectTrigger
                    id="ls-cfg-source-select"
                    className="w-full text-xs"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSources.map((s) => (
                      <SelectItem
                        key={s.value}
                        value={s.value}
                        className="text-xs"
                      >
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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
          {isDeviceError && (
            <p className="text-destructive text-[10px]">
              Failed to fetch GPU devices. Check that the helper service is
              running.
            </p>
          )}
        </div>
      </div>

      <Separator />

      <div className="space-y-3 px-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          WebRTC
        </p>
        <div className="space-y-2">
          <Label
            htmlFor="ls-cfg-client-ice-server"
            className="text-muted-foreground text-xs"
          >
            <Network className="mr-1 inline-block h-3 w-3" />
            Client ICE Server URL
          </Label>
          <Input
            id="ls-cfg-client-ice-server"
            value={draftClientIceServerUrl}
            onChange={(e) => setDraftClientIceServerUrl(e.target.value)}
            placeholder="e.g. 192.168.1.100:19302"
            className="text-xs"
          />
          <p className="text-muted-foreground text-[10px]">
            ICE server for the browser client. Auto-prefixed with stun: if no
            scheme is provided. Leave empty to use no ICE server.
          </p>
        </div>
        <div className="space-y-2">
          <Label
            htmlFor="ls-cfg-server-ice-server"
            className="text-muted-foreground text-xs"
          >
            <Network className="mr-1 inline-block h-3 w-3" />
            Server ICE Server URL
          </Label>
          <Input
            id="ls-cfg-server-ice-server"
            value={draftServerIceServerUrl}
            onChange={(e) => setDraftServerIceServerUrl(e.target.value)}
            placeholder="e.g. localhost:5901"
            className="text-xs"
          />
          <p className="text-muted-foreground text-[10px]">
            ICE server for the lipsync worker. Auto-prefixed with turn: if no
            scheme is provided. Leave empty to use no ICE server.
          </p>
        </div>
      </div>

      <Separator />

      <ClearModelCacheSection service={service} />
    </ServiceConfigurePanel>
  )
}
