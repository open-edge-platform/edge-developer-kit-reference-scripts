// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Ban, Cpu, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useSystemInfo } from '@/context/system-info-context'
import { supportedBackends } from '@/engines/multiserve/backends'
import {
  KNOWN_QUANTIZATIONS,
  MODEL_TYPES,
  OVMS_PIPELINE_TYPES,
} from '@/engines/multiserve/config'
import {
  useEngineHealth,
  useStartEngine,
} from '@/engines/multiserve/hooks/use-engine-health'
import type {
  BackendId,
  ModelSource,
  ModelUsage,
} from '@/engines/multiserve/types'
import {
  buildExtraParams,
  inferModelUsage,
  isKnownWeightFormat,
  isOpenVINONativeModel,
  validateModelName,
} from '@/engines/multiserve/validation'
import { useDevicesQuery } from '@/hooks/use-devices'
import { useUpdateServiceConfig } from '@/hooks/use-service-config'
import {
  type ConfigurePanelStatus,
  ServiceConfigurePanel,
} from '@/components/common/service-configure-panel'
import { getOSLabel } from '@/lib/utils'
import {
  CpuAffinitySection,
  isCpuAffinityValid,
  normalizeCpuAffinity,
} from '@/components/common/cpu-affinity-section'
import { ModelManager } from '../model-manager'
import { ConfigSection, LabelWithTooltip } from './config-section'
import { ExtraParamsSection } from './extra-params-section'
import { buildInitialDraft, type ConfigDraft } from './types'

interface ConfigurableService {
  id: string
  name: string
  dbId?: number
  currentModel?: string
  currentDevice?: string
  currentBackend?: string
  currentQuant?: string
  currentSource?: string
  metadata?: unknown
  defaultModel?: {
    name: string
    device: string
    backend?: string
    quant?: string
  }
}

interface MultiserveConfigurePanelProps {
  service: ConfigurableService
}

export function MultiserveConfigurePanel({
  service,
}: MultiserveConfigurePanelProps) {
  const { systemInfo } = useSystemInfo()
  const isLinux = systemInfo?.os === 'linux'
  const currentModel = service.currentModel ?? service.defaultModel?.name ?? ''
  const currentDevice =
    service.currentDevice ?? service.defaultModel?.device ?? ''
  const currentBackend = service.currentBackend ?? service.defaultModel?.backend
  const currentQuant = service.currentQuant ?? service.defaultModel?.quant
  const currentSource = service.currentSource
  const currentCpuAffinity =
    (service.metadata as { cpuAffinity?: string } | undefined)?.cpuAffinity ??
    ''

  const [open, setOpen] = useState(false)
  const [draftCpuAffinity, setDraftCpuAffinity] = useState(currentCpuAffinity)
  const [draft, setDraft] = useState<ConfigDraft>(() =>
    buildInitialDraft(
      currentModel,
      currentDevice,
      currentBackend,
      systemInfo?.os,
      currentQuant,
      currentSource,
    ),
  )

  const { mutate: updateConfig, isPending: isSaving } = useUpdateServiceConfig()

  const { data: isEngineUp } = useEngineHealth(service.id, open)
  const { mutate: startEngine } = useStartEngine(service.id)
  const autoStarted = useRef(false)

  useEffect(() => {
    if (open && isEngineUp === false && service.dbId && !autoStarted.current) {
      autoStarted.current = true
      startEngine(service.dbId)
    }
    if (!open) {
      autoStarted.current = false
    }
  }, [open, isEngineUp, service.dbId, startEngine])

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setDraft(
          buildInitialDraft(
            currentModel,
            currentDevice,
            currentBackend,
            systemInfo?.os,
            currentQuant,
            currentSource,
          ),
        )
        setDraftCpuAffinity(currentCpuAffinity)
      }
      setOpen(newOpen)
    },
    [
      currentModel,
      currentDevice,
      currentBackend,
      systemInfo?.os,
      currentQuant,
      currentSource,
      currentCpuAffinity,
    ],
  )

  const selectedBackend = useMemo(
    () => supportedBackends.find((b) => b.value === draft.backend),
    [draft.backend],
  )

  const {
    data: backendDevices,
    isLoading: isDevicesLoading,
    isError: isDevicesError,
  } = useDevicesQuery(draft.backend)

  const filteredDevices = backendDevices ?? []

  // Reconcile draft.device with fetched device list
  const [normalizedDevices, setNormalizedDevices] = useState(backendDevices)
  if (backendDevices !== normalizedDevices) {
    setNormalizedDevices(backendDevices)
    if (backendDevices && backendDevices.length > 0) {
      const exactMatch = backendDevices.some((d) => d.value === draft.device)
      if (!exactMatch) {
        const caseMatch = backendDevices.find(
          (d) => d.value.toLowerCase() === draft.device.toLowerCase(),
        )
        if (caseMatch) {
          setDraft((prev) => ({ ...prev, device: caseMatch.value }))
        } else if (
          draft.device &&
          !backendDevices.some((d) => d.value === draft.device)
        ) {
          setDraft((prev) => ({ ...prev, device: backendDevices[0].value }))
        }
      }
    }
  }

  const showOpenVINOOptions =
    draft.backend === 'openvino' && draft.modelName.trim() !== ''

  const needsWeightFormat =
    showOpenVINOOptions &&
    validateModelName(draft.modelName, 'openvino') &&
    !isOpenVINONativeModel(draft.modelName)

  const normalizedDraftAffinity = normalizeCpuAffinity(draftCpuAffinity)
  const cpuAffinityChanged =
    normalizedDraftAffinity !== normalizeCpuAffinity(currentCpuAffinity)
  const cpuAffinityValid = isCpuAffinityValid(draftCpuAffinity)

  const isValid = draft.modelName.trim().length > 0 && cpuAffinityValid

  // For llamacpp, quant is baked into the stored name (e.g. "repo:Q8_0")
  const storedEffectiveName =
    currentBackend === 'llamacpp'
      ? currentQuant && !currentModel.endsWith(`:${currentQuant}`)
        ? `${currentModel}:${currentQuant}`
        : currentModel
      : currentModel
  const draftEffectiveName =
    draft.backend === 'llamacpp' && draft.quant
      ? `${draft.modelName}:${draft.quant}`
      : draft.modelName

  const isDirty =
    draftEffectiveName !== storedEffectiveName ||
    draft.device.toLowerCase() !== currentDevice.toLowerCase() ||
    (draft.backend !== 'llamacpp' && draft.quant !== (currentQuant ?? '')) ||
    (currentBackend !== undefined && draft.backend !== currentBackend) ||
    cpuAffinityChanged

  const updateDraft = useCallback(
    (patch: Partial<ConfigDraft>) =>
      setDraft((prev) => ({ ...prev, ...patch })),
    [],
  )

  const handleBackendChange = useCallback(
    (value: string) => {
      const backend = value as BackendId
      const newBackend = supportedBackends.find((b) => b.value === backend)
      const defaultDevice = (
        newBackend?.supportedDevices[0] ?? 'cpu'
      ).toUpperCase()
      updateDraft({
        backend,
        device: defaultDevice,
        modelName: '',
        source: 'huggingface',
        quant: '',
        pipelineType: 'AUTO',
        weightFormat: '',
        weightFormatAutoFilled: false,
        additionalParams: '',
        modelType: 'default',
      })
    },
    [updateDraft],
  )

  const handlePipelineTypeChange = useCallback(
    (value: string) => {
      updateDraft({
        pipelineType: value,
        modelType: inferModelUsage(value),
      })
    },
    [updateDraft],
  )

  const handleSelectModel = useCallback(
    (
      repoId: string,
      backend: BackendId,
      taskType: ModelUsage,
      quant?: string,
      verifiedWeightFormat?: string,
      additionalParams?: string,
      source?: ModelSource,
    ) => {
      setDraft((prev) => {
        const hasVerifiedWeightFormat = verifiedWeightFormat != null
        const nextWeightFormat = hasVerifiedWeightFormat
          ? verifiedWeightFormat
          : prev.weightFormatAutoFilled
            ? ''
            : prev.weightFormat

        return {
          ...prev,
          modelName: repoId,
          backend,
          modelType: taskType,
          quant: quant ?? '',
          weightFormat: nextWeightFormat,
          weightFormatAutoFilled: hasVerifiedWeightFormat,
          additionalParams: additionalParams ?? prev.additionalParams,
          ...(source != null && { source }),
        }
      })
    },
    [],
  )

  const handleCancel = useCallback(() => {
    setDraft(
      buildInitialDraft(
        currentModel,
        currentDevice,
        currentBackend,
        systemInfo?.os,
        currentQuant,
        currentSource,
      ),
    )
    setDraftCpuAffinity(currentCpuAffinity)
  }, [
    currentModel,
    currentDevice,
    currentBackend,
    systemInfo?.os,
    currentQuant,
    currentSource,
    currentCpuAffinity,
  ])

  const handleSave = useCallback(() => {
    if (!service.dbId || !isValid) return

    const params =
      draft.backend === 'openvino'
        ? buildExtraParams({
            pipelineType: draft.pipelineType,
            weightFormat: needsWeightFormat ? draft.weightFormat : '',
            additionalParams: draft.additionalParams,
          })
        : undefined

    // Bake quant into name for llamacpp healthcheck matching
    const savedName =
      draft.backend === 'llamacpp' && draft.quant
        ? `${draft.modelName}:${draft.quant}`
        : draft.modelName

    updateConfig(
      {
        serviceId: service.dbId,
        serviceType: service.id,
        config: {
          name: savedName,
          device: draft.device,
          backend: draft.backend,
          source: draft.source === 'preset' ? 'huggingface' : draft.source,
          ...(draft.modelType !== 'default' && { type: draft.modelType }),
          ...(draft.backend !== 'llamacpp' &&
            draft.quant && { quant: draft.quant }),
          ...(params && { params }),
          ...(cpuAffinityChanged && {
            metadata: { cpuAffinity: normalizedDraftAffinity },
          }),
        },
      },
      {
        onSuccess: () => setOpen(false),
      },
    )
  }, [
    service.dbId,
    service.id,
    draft,
    isValid,
    updateConfig,
    needsWeightFormat,
    cpuAffinityChanged,
    normalizedDraftAffinity,
  ])

  const statusItems: ConfigurePanelStatus[] = [
    { label: 'Current model', value: currentModel || '—' },
    { label: 'Current device', value: currentDevice || '—' },
    { label: 'Backend', value: currentBackend ?? '—' },
    ...(isLinux
      ? [
          {
            label: 'CPU affinity',
            value: currentCpuAffinity || 'all cores',
          },
        ]
      : []),
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
      <ConfigSection title="Backend">
        <TooltipProvider>
          <div className="grid grid-cols-2 gap-2">
            {supportedBackends.map((b) => {
              const isUnsupported =
                systemInfo?.os != null && !b.supportedOS.includes(systemInfo.os)
              const isRecommended =
                systemInfo?.os != null && b.recommendedOS === systemInfo.os

              const button = (
                <Button
                  key={b.value}
                  data-testid={`backend-${b.value}`}
                  type="button"
                  size="sm"
                  variant={draft.backend === b.value ? 'default' : 'outline'}
                  disabled={isUnsupported}
                  onClick={() => handleBackendChange(b.value)}
                  className={isUnsupported ? 'opacity-50' : ''}
                >
                  {isUnsupported && <Ban className="mr-1 h-3 w-3" />}
                  {b.name}
                  {isRecommended && !isUnsupported && (
                    <span className="ml-1 text-[9px] opacity-60">
                      (recommended)
                    </span>
                  )}
                </Button>
              )

              if (isUnsupported) {
                return (
                  <Tooltip key={b.value}>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">{button}</span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      Not available on{' '}
                      {systemInfo?.os
                        ? getOSLabel(systemInfo.os)
                        : 'this system'}
                    </TooltipContent>
                  </Tooltip>
                )
              }

              return button
            })}
          </div>
        </TooltipProvider>
        {selectedBackend && (
          <p className="text-muted-foreground mt-1 text-[10px]">
            {selectedBackend.description}
          </p>
        )}
      </ConfigSection>

      <Separator />

      <ModelManager
        serviceId={service.id}
        dbId={service.dbId}
        backend={draft.backend}
        onSelectModel={handleSelectModel}
        selectedModel={draft.modelName}
        selectedSource={
          draft.source === 'preset' ? 'huggingface' : draft.source
        }
      />

      {showOpenVINOOptions && (
        <>
          <Separator />
          <ConfigSection title="Pipeline Type">
            <LabelWithTooltip
              label="Pipeline type"
              tooltip="Determines how the model is served. VLM/VLM_CB enables vision-language (multimodal) mode."
            />
            <Select
              value={draft.pipelineType}
              onValueChange={handlePipelineTypeChange}
            >
              <SelectTrigger className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OVMS_PIPELINE_TYPES.map((pt) => (
                  <SelectItem
                    key={pt.value}
                    value={pt.value}
                    className="text-xs"
                  >
                    {pt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ConfigSection>
        </>
      )}

      {needsWeightFormat && (
        <>
          <Separator />
          <ConfigSection title="Weight Format">
            <div className="rounded-md border border-blue-200 bg-blue-50 p-2.5 dark:border-blue-900 dark:bg-blue-950">
              <p className="text-[11px] text-blue-800 dark:text-blue-200">
                This model doesn&apos;t follow OpenVINO naming convention and
                requires conversion. Specify the weight format below.
              </p>
            </div>
            <LabelWithTooltip
              label="Weight format *"
              tooltip="Quantization format for model conversion (e.g., int4, int8, fp16)."
            />
            <Input
              value={draft.weightFormat}
              onChange={(e) =>
                updateDraft({
                  weightFormat: e.target.value,
                  weightFormatAutoFilled: false,
                })
              }
              placeholder="e.g., int4, int8, fp16"
              className="text-xs"
            />
            {draft.weightFormat && !isKnownWeightFormat(draft.weightFormat) && (
              <p className="text-[11px] text-red-500">
                Unknown format. Known:{' '}
                {(KNOWN_QUANTIZATIONS as readonly string[]).join(', ')}
              </p>
            )}
          </ConfigSection>
        </>
      )}

      {draft.backend === 'llamacpp' && draft.modelName.trim() !== '' && (
        <>
          <Separator />
          <ConfigSection title="Model Type">
            <LabelWithTooltip
              label="Inference type"
              tooltip="Select 'Multimodal (VLM)' for vision-language models that accept image inputs."
            />
            <Select
              value={draft.modelType}
              onValueChange={(v) => updateDraft({ modelType: v as ModelUsage })}
            >
              <SelectTrigger className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_TYPES.map((mt) => (
                  <SelectItem
                    key={mt.value}
                    value={mt.value}
                    className="text-xs"
                  >
                    {mt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ConfigSection>
        </>
      )}

      <Separator />

      <ConfigSection title="Accelerator">
        <div className="space-y-2">
          <Label className="text-muted-foreground text-xs">
            <Cpu className="mr-1 inline-block h-3 w-3" />
            Device
          </Label>
          {isDevicesLoading ? (
            <Skeleton className="h-9 w-full" />
          ) : isDevicesError || filteredDevices.length === 0 ? (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 dark:border-red-900 dark:bg-red-950">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
              <p className="text-[11px] text-red-700 dark:text-red-300">
                Failed to fetch devices for the{' '}
                <span className="font-medium">
                  {selectedBackend?.name ?? draft.backend}
                </span>{' '}
                backend. Check that the backend runtime is installed.
              </p>
            </div>
          ) : (
            <Select
              value={draft.device}
              onValueChange={(v) => updateDraft({ device: v })}
            >
              <SelectTrigger
                data-testid="cfg-device-select"
                id="cfg-device-select"
                className="w-full text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {filteredDevices.map((d) => (
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
          )}
        </div>
      </ConfigSection>

      {showOpenVINOOptions && (
        <>
          <Separator />
          <ExtraParamsSection
            value={draft.additionalParams}
            onChange={(v) => updateDraft({ additionalParams: v })}
          />
        </>
      )}

      {isLinux && (
        <>
          <Separator />
          <CpuAffinitySection
            value={draftCpuAffinity}
            onChange={setDraftCpuAffinity}
            currentServiceId={service.id}
          />
        </>
      )}
    </ServiceConfigurePanel>
  )
}
