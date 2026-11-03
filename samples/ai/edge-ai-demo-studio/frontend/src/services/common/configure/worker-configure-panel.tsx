// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Fragment, useId, useState } from 'react'
import { CpuAffinitySection } from '@/components/configure/cpu-affinity-section'
import {
  type ConfigurePanelStatus,
  type ConfigureSaveRequest,
  ServiceConfigurePanel,
} from '@/components/configure/service-configure-panel'
import { cpuAffinityStatusItem } from '@/components/configure/status-items'
import { Separator } from '@/components/ui/separator'
import { useSystemInfo } from '@/context/system-info-context'
import { useDraftPreview } from '@/hooks/use-configure-draft'
import { useConfigureSheet } from '@/hooks/use-configure-sheet'
import { useCpuAffinityDraft } from '@/hooks/use-cpu-affinity-draft'
import { useUpdateServiceConfig } from '@/hooks/use-service-config'
import { supportsCpuAffinity } from '@/lib/instances/cpu-affinity'
import { getServiceMetadata } from '@/lib/instances/service-metadata'
import {
  getEffectivePrecision,
  getModelPrecision,
  getWeightFormatsForModel,
  offersPrecision,
  supportsCustomModels,
} from '@/services/model-config'
import { isModelSource } from '@/types/common'
import { getEffectiveModel } from '@/types/service'
import { AcceleratorSection } from './accelerator-section'
import { ClearModelCacheSection } from './clear-model-cache-section'
import { DownloadedModelsSection } from './downloaded-models-section'
import { ModelSourceSection } from './model-source-section'
import { PrecisionSection, precisionLabel } from './precision-section'
import { separatedSections } from './separated-sections'
import { useWorkerDevice } from './use-worker-device'
import { useWorkerModelCatalog } from './use-worker-model-catalog'
import { useWorkerModelDraft } from './use-worker-model-draft'
import { WorkerModelSection } from './worker-model-section'
import type {
  WorkerConfigurePanelProps,
  WorkerModelDraft,
} from './worker-configure-panel-props'
import { workerSaveConfig } from './worker-save-config'

/**
 * Runtime Settings of a worker service: model, registry, accelerator, CPU pinning and model cache.
 * Services with more settings compose it through its slots rather than copying it.
 */
export function WorkerConfigurePanel({
  service,
  engineTabs,
  leadingSection,
  modelScope,
  startModel,
  settingDescriptions,
  open: controlledOpen,
  onOpenChange,
  extension,
  modelSection,
  renderAfterModel,
  renderModelHint,
  renderModelNote,
  renderDeviceNote,
  advanced: serviceAdvanced,
  statusItems: serviceStatusItems = [],
  listPresetsBy = 'value',
  modelSelectId,
  modelSelectTestId = 'cfg-model-select',
  clearModelCache,
}: WorkerConfigurePanelProps) {
  const fieldId = useId()
  const presets = service.config?.availableModels ?? []
  const sources = (service.config?.availableModelSources ?? []).filter((s) =>
    isModelSource(s.value),
  )
  // A single registry is no choice: it is saved, but not offered.
  const choosesSource = sources.length > 1
  const supportsCustom = supportsCustomModels(service.config)
  const ownsModel = !modelSection && (presets.length > 0 || supportsCustom)

  const { systemInfo } = useSystemInfo()
  const canPinCpus = supportsCpuAffinity(systemInfo?.os)

  const current = getEffectiveModel(service)
  const currentCpuAffinity = getServiceMetadata(service).cpuAffinity ?? ''
  const draftStart = startModel ? { ...current, ...startModel } : current
  const {
    sourceType,
    setSourceType,
    customModel,
    setCustomModel,
    draft,
    setDraft,
    resolvedModel,
    changed: modelDraftChanged,
    reset: resetModelDraft,
  } = useWorkerModelDraft({ current: draftStart, presets, supportsCustom })
  const cpuAffinity = useCpuAffinityDraft(currentCpuAffinity)

  // The precision the worker converts the model to, where the service
  // offers a choice; kept when the model or the scope changes.
  const choosesPrecision = ownsModel && offersPrecision(service.config)
  const defaultPrecision = service.config?.defaultWeightFormat ?? ''
  const currentPrecision =
    getEffectivePrecision(service.config, current.quant) ?? ''
  const [precision, setPrecision] = useState(currentPrecision)
  const precisionChanged = choosesPrecision && precision !== currentPrecision

  // A new scope brings a new model list: only the model drafts start over.
  const [draftedScope, setDraftedScope] = useState(modelScope)
  if (draftedScope !== modelScope) {
    setDraftedScope(modelScope)
    resetModelDraft()
  }

  const sheet = useConfigureSheet({
    open: controlledOpen,
    onOpenChange,
    reset: () => {
      resetModelDraft()
      cpuAffinity.reset()
      setPrecision(currentPrecision)
      extension?.reset()
    },
  })

  const modelCatalog = useWorkerModelCatalog(service, sheet.active)
  const devices = useWorkerDevice(service.config, draft.model, draft.device)
  const { device } = devices
  const drafted: WorkerModelDraft = { model: resolvedModel, device }
  const draftedPrecisions = ownsModel
    ? getWeightFormatsForModel(service.config, resolvedModel)
    : []
  const savedPrecision = ownsModel
    ? getModelPrecision(service.config, current.name, current.quant)
    : undefined

  // Against what is saved, not where the drafts started.
  const modelChanged =
    ownsModel &&
    (modelDraftChanged ||
      (startModel !== undefined &&
        (resolvedModel !== current.name ||
          (sources.length > 0 && draft.source !== current.source))))
  const isDirty =
    sheet.open &&
    (modelChanged ||
      precisionChanged ||
      cpuAffinity.changed ||
      Boolean(extension?.changed))
  const isValid =
    (!ownsModel || resolvedModel.length > 0) &&
    cpuAffinity.valid &&
    (extension?.valid ?? true)

  const {
    mutate: updateConfig,
    isPending: isSaving,
    phase: savePhase,
  } = useUpdateServiceConfig()
  const handleSave = (request?: ConfigureSaveRequest) => {
    if (!isValid) return
    updateConfig(
      {
        serviceId: service.dbId,
        serviceType: service.id,
        restart: request?.restart,
        config: workerSaveConfig({
          model: ownsModel
            ? {
                name: resolvedModel,
                device,
                source: sources.length > 0 ? draft.source : undefined,
                quant: precisionChanged
                  ? precision
                  : (service.currentQuant ?? undefined),
              }
            : undefined,
          extension: extension?.config,
          cpuAffinity: cpuAffinity.changed ? cpuAffinity.normalized : undefined,
        }),
      },
      { onSuccess: sheet.close },
    )
  }

  useDraftPreview(
    ownsModel ? resolvedModel || undefined : extension?.preview?.model,
    ownsModel ? device : extension?.preview?.device,
  )

  const statusItems: ConfigurePanelStatus[] = [
    ...(modelSection
      ? []
      : [
          { label: 'Model', value: current.name || '—' },
          { label: 'Device', value: current.device || '—' },
          ...(savedPrecision
            ? [{ label: 'Precision', value: precisionLabel(savedPrecision) }]
            : []),
        ]),
    ...serviceStatusItems,
    ...cpuAffinityStatusItem(canPinCpus, currentCpuAffinity),
  ]

  // Recommended values suit most setups, so a new instance keeps these folded away.
  const advanced = separatedSections([
    ownsModel && (supportsCustom || choosesSource) && (
      <ModelSourceSection
        key="source"
        fieldId={fieldId}
        supportsCustom={supportsCustom}
        sourceType={sourceType}
        onSourceTypeChange={setSourceType}
        sources={choosesSource ? sources : []}
        source={draft.source}
        onSourceChange={(source) => setDraft({ source })}
      />
    ),
    draftedPrecisions.length > 0 && (
      <PrecisionSection
        key="precision"
        formats={draftedPrecisions}
        defaultFormat={defaultPrecision}
        value={precision}
        onChange={setPrecision}
      />
    ),
    serviceAdvanced && <Fragment key="service">{serviceAdvanced}</Fragment>,
    canPinCpus && (
      <CpuAffinitySection
        key="cpu"
        value={cpuAffinity.draft}
        onChange={cpuAffinity.setDraft}
        currentInstanceKey={sheet.isDraft ? undefined : service.instanceKey}
      />
    ),
  ])

  return (
    <ServiceConfigurePanel
      service={service}
      statusItems={statusItems}
      settingDescriptions={
        choosesPrecision
          ? {
              quant: {
                label: 'Precision',
                format: precisionLabel,
                unset: `${precisionLabel(defaultPrecision)} (default)`,
              },
              ...settingDescriptions,
            }
          : settingDescriptions
      }
      isDirty={isDirty}
      isValid={isValid}
      onSave={handleSave}
      isSaving={isSaving}
      savePhase={savePhase}
      open={sheet.open}
      onOpenChange={sheet.onOpenChange}
      // A leading choice (a backend) goes first under Advanced, like the engine choice.
      engineTabs={engineTabs ?? leadingSection}
      advanced={advanced}
      maintenance={
        (clearModelCache ?? ownsModel) && (
          <>
            <DownloadedModelsSection
              service={service}
              scan={modelCatalog.catalog}
            />
            <ClearModelCacheSection service={service} />
          </>
        )
      }
    >
      {typeof modelSection === 'function'
        ? modelSection({ active: sheet.active, catalog: modelCatalog })
        : modelSection}

      {ownsModel && (
        <WorkerModelSection
          fieldId={fieldId}
          sourceType={sourceType}
          presets={presets}
          model={draft.model}
          onModelChange={(model) => setDraft({ model })}
          customModel={customModel}
          onCustomModelChange={setCustomModel}
          catalog={modelCatalog}
          listPresetsBy={listPresetsBy}
          modelSelectId={modelSelectId}
          modelSelectTestId={modelSelectTestId}
          renderModelHint={renderModelHint}
          note={renderModelNote?.(drafted)}
        />
      )}

      {ownsModel && renderAfterModel && (
        <>
          <Separator />
          {renderAfterModel(drafted)}
        </>
      )}

      {ownsModel && (
        <>
          <Separator />
          <AcceleratorSection
            id={`${fieldId}-device`}
            devices={devices}
            onDeviceChange={(v) => setDraft({ device: v })}
            note={renderDeviceNote?.(drafted)}
          />
        </>
      )}
    </ServiceConfigurePanel>
  )
}
