// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { ReactNode } from 'react'
import { ConfigSection } from '@/components/configure/config-section'
import { DeviceSelect } from '@/components/configure/device-select'
import {
  type ConfigurePanelStatus,
  type ConfigureSaveRequest,
  ServiceConfigurePanel,
} from '@/components/configure/service-configure-panel'
import { useDevicesQuery } from '@/hooks/use-devices'
import { useDraftState } from '@/hooks/use-draft-state'
import { useUpdateServiceConfig } from '@/hooks/use-service-config'
import { getServiceMetadata } from '@/lib/instances/service-metadata'
import { getEffectiveModel } from '@/types/service'
import type { DeviceOption, Service } from '@/services/types'
import { useConfigureSheet } from '@/hooks/use-configure-sheet'

/** The device value that lets each model of the pipeline pick its own. */
const HETERO = 'HETERO'

/** One model of a pipeline that can run on its own device (HETERO). */
export interface SuiteModelDevice {
  /** The `metadata` key the device is saved under, e.g. `detectDevice`. */
  key: string
  label: string
  testId: string
}

export interface SuiteDeviceConfigurePanelProps {
  service: Service
  /** The fixed model name the suite saves with its device. */
  modelName: string
  /** What the device selects, under the picker. */
  hint: ReactNode
  /** Test id (and DOM id) of the device picker. */
  testId?: string
  /** Device families the pipeline runs on; the OpenVINO devices are filtered to them. */
  supportedDevices?: string[]
  /** Offers a `HETERO` device where each of these models picks its own, saved to `metadata[key]`. */
  perModelDevices?: SuiteModelDevice[]
}

function matchesFamily(device: string, families: string[]): boolean {
  const upper = device.toUpperCase()
  return families.some((f) => upper === f || upper.startsWith(`${f}.`))
}

/**
 * Runtime Settings of an AI-suite pipeline with a fixed model: one OpenVINO device picker, optionally
 * with a device per stage (`HETERO`).
 */
export function SuiteDeviceConfigurePanel({
  service,
  modelName,
  hint,
  testId = 'cfg-device-select',
  supportedDevices = ['CPU', 'GPU', 'NPU'],
  perModelDevices,
}: SuiteDeviceConfigurePanelProps) {
  const currentDevice = getEffectiveModel(service).device || 'CPU'
  const metadata = getServiceMetadata(service)
  // A per-model device defaults to the pipeline's own one.
  const baseDevice = currentDevice === HETERO ? 'CPU' : currentDevice
  const currentPerModel = Object.fromEntries(
    (perModelDevices ?? []).map(({ key }) => [
      key,
      typeof metadata[key] === 'string'
        ? (metadata[key] as string)
        : baseDevice,
    ]),
  )

  // `device`, and each per-model device by its metadata key.
  const { draft, setDraft, reset } = useDraftState<Record<string, string>>({
    ...currentPerModel,
    device: currentDevice,
  })
  const sheet = useConfigureSheet({ reset })
  const {
    mutate: updateConfig,
    isPending: isSaving,
    phase: savePhase,
  } = useUpdateServiceConfig()

  const {
    data: openvinoDevices,
    isLoading,
    isError,
    refetch,
  } = useDevicesQuery('openvino')
  const detected = (openvinoDevices ?? []).filter((d) =>
    matchesFamily(d.value, supportedDevices),
  )
  // Detection that found none of the families still offers them by name.
  const deviceOptions: DeviceOption[] =
    detected.length > 0
      ? detected
      : supportedDevices.map((d) => ({ value: d, label: d }))
  const isHetero = perModelDevices !== undefined && draft.device === HETERO

  const changed =
    draft.device.toLowerCase() !== currentDevice.toLowerCase() ||
    (isHetero &&
      perModelDevices.some(({ key }) => draft[key] !== currentPerModel[key]))

  const handleSave = (request?: ConfigureSaveRequest) =>
    updateConfig(
      {
        serviceId: service.dbId,
        serviceType: service.id,
        restart: request?.restart,
        config: {
          name: modelName,
          device: draft.device,
          ...(isHetero && {
            metadata: Object.fromEntries(
              perModelDevices.map(({ key }) => [key, draft[key]]),
            ),
          }),
        },
      },
      { onSuccess: sheet.close },
    )

  const statusItems: ConfigurePanelStatus[] = [
    {
      label: 'Device',
      value:
        perModelDevices && currentDevice === HETERO
          ? perModelDevices
              .map(({ key, label }) => `${label}: ${currentPerModel[key]}`)
              .join(' / ')
          : currentDevice,
    },
  ]

  return (
    <ServiceConfigurePanel
      service={service}
      statusItems={statusItems}
      isDirty={sheet.open && changed}
      isValid
      onSave={handleSave}
      isSaving={isSaving}
      savePhase={savePhase}
      open={sheet.open}
      onOpenChange={sheet.onOpenChange}
    >
      <ConfigSection title="Accelerator">
        <DeviceSelect
          id={testId}
          testId={testId}
          value={draft.device}
          onValueChange={(device) => setDraft({ device })}
          options={
            perModelDevices
              ? [
                  ...deviceOptions,
                  { value: HETERO, label: 'HETERO (per-model)' },
                ]
              : deviceOptions
          }
          isLoading={isLoading}
          isError={isError}
          onRetry={() => void refetch()}
        />
        <p className="text-muted-foreground text-xs">{hint}</p>

        {isHetero && (
          <div className="border-border space-y-3 border-l pl-2">
            {perModelDevices.map(({ key, label, testId: modelTestId }) => (
              <DeviceSelect
                key={key}
                id={modelTestId}
                testId={modelTestId}
                label={label}
                value={draft[key] ?? baseDevice}
                onValueChange={(device) => setDraft({ [key]: device })}
                options={deviceOptions}
                isLoading={isLoading}
                isError={isError}
                onRetry={() => void refetch()}
              />
            ))}
          </div>
        )}
      </ConfigSection>
    </ServiceConfigurePanel>
  )
}
