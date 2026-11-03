// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ConfigSection } from '@/components/configure/config-section'
import { CpuAffinitySection } from '@/components/configure/cpu-affinity-section'
import {
  type ConfigurePanelStatus,
  ServiceConfigurePanel,
} from '@/components/configure/service-configure-panel'
import { cpuAffinityStatusItem } from '@/components/configure/status-items'
import { Separator } from '@/components/ui/separator'
import { serverArgTask } from '@/engines/multiserve/server-args'
import { inferModelUsage } from '@/engines/multiserve/validation'
import type { EngineConfigurePanelProps } from '@/engines/types'
import { ModelManager } from '../model-manager'
import { ModelSourcePicker } from '../model-source-picker'
import { AcceleratorSection } from './accelerator-section'
import { BackendSection } from './backend-section'
import { ExtraParamsSection } from './extra-params-section'
import { ModelTypeSection } from './model-type-section'
import { PipelineTypeSection } from './pipeline-type-section'
import { ServerArgsSection } from './server-args-section'
import { useMultiserveConfigDraft } from './use-multiserve-config-draft'
import { WeightFormatSection } from './weight-format-section'

/** Runtime Settings of a multiserve-engine service. */
export function MultiserveConfigurePanel({
  service,
  engineTabs,
  open,
  onOpenChange,
}: EngineConfigurePanelProps) {
  const {
    os,
    canPinCpus,
    current,
    currentCpuAffinity,
    draft,
    updateDraft,
    draftEngine,
    cpuAffinity,
    sheet,
    isSaving,
    savePhase,
    backendDevices,
    isDevicesLoading,
    isDevicesError,
    refetchDevices,
    showOpenVINOOptions,
    needsWeightFormat,
    isValid,
    isDirty,
    handleBackendChange,
    handleSelectModel,
    handleSave,
  } = useMultiserveConfigDraft(service, { open, onOpenChange })

  const instanceKey = service.instanceKey ?? service.id

  const statusItems: ConfigurePanelStatus[] = [
    { label: 'Model', value: current.name || '—' },
    { label: 'Device', value: current.device || '—' },
    { label: 'Backend', value: current.backend ?? '—' },
    ...cpuAffinityStatusItem(canPinCpus, currentCpuAffinity),
  ]

  // Recommended values suit most setups, so a new instance keeps these folded away.
  const advanced = (
    <>
      <BackendSection
        value={draft.backend}
        os={os}
        onChange={handleBackendChange}
      />
      <Separator />
      <ConfigSection title="Model source">
        <ModelSourcePicker
          value={draft.source}
          onChange={(source) => updateDraft({ source })}
        />
      </ConfigSection>
      {showOpenVINOOptions && (
        <>
          <Separator />
          <PipelineTypeSection
            value={draft.pipelineType}
            onChange={(value) =>
              updateDraft({
                pipelineType: value,
                modelType: inferModelUsage(value),
              })
            }
          />
        </>
      )}
      {draft.backend === 'llamacpp' && draft.modelName.trim() !== '' && (
        <>
          <Separator />
          <ModelTypeSection
            value={draft.modelType}
            onChange={(modelType) => updateDraft({ modelType })}
          />
        </>
      )}
      {showOpenVINOOptions && (
        <>
          <Separator />
          <ExtraParamsSection
            value={draft.additionalParams}
            onChange={(v) => updateDraft({ additionalParams: v })}
          />
        </>
      )}
      <Separator />
      <ServerArgsSection
        backend={draft.backend}
        task={serverArgTask(service.id)}
        value={draft.serverArgs}
        onChange={(serverArgs) => updateDraft({ serverArgs })}
      />
      {canPinCpus && (
        <>
          <Separator />
          <CpuAffinitySection
            value={cpuAffinity.draft}
            onChange={cpuAffinity.setDraft}
            currentInstanceKey={sheet.isDraft ? undefined : service.instanceKey}
          />
        </>
      )}
    </>
  )

  return (
    <ServiceConfigurePanel
      service={service}
      statusItems={statusItems}
      isDirty={isDirty}
      isValid={isValid}
      onSave={handleSave}
      isSaving={isSaving}
      savePhase={savePhase}
      open={sheet.open}
      onOpenChange={sheet.onOpenChange}
      engineTabs={engineTabs}
      advanced={advanced}
    >
      <ModelManager
        instanceKey={instanceKey}
        dbId={service.dbId}
        backend={draft.backend}
        onSelectModel={handleSelectModel}
        selectedModel={draft.modelName}
        selectedQuant={draft.quant}
        source={draft.source}
        draftEngine={draftEngine}
      />

      {needsWeightFormat && (
        <>
          <Separator />
          <WeightFormatSection
            value={draft.weightFormat}
            onChange={(weightFormat) =>
              updateDraft({ weightFormat, weightFormatAutoFilled: false })
            }
          />
        </>
      )}

      <Separator />

      <AcceleratorSection
        backend={draft.backend}
        value={draft.device}
        onValueChange={(v) =>
          updateDraft({ device: v, deviceAutoFilled: false })
        }
        options={backendDevices ?? []}
        isLoading={isDevicesLoading}
        isError={isDevicesError}
        onRetry={() => void refetchDevices()}
      />
    </ServiceConfigurePanel>
  )
}
