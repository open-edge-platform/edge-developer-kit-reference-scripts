// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ConfigSection } from '@/components/configure/config-section'
import { Badge } from '@/components/ui/badge'
import { useConfigureDraftHost } from '@/hooks/use-configure-draft'
import type { ServiceModelCatalog } from '@/hooks/use-model-catalog'
import { formatBytes } from '@/lib/browser/format'
import type { Service } from '@/services/types'
import { getEffectiveModel } from '@/types/service'
import { DeleteModelButton } from './delete-model-button'

/**
 * Lists a worker service's models with files on disk (whole or partial) and deletes one at a time,
 * on confirm. The model a running instance uses cannot be deleted until it stops. Shown in
 * Runtime Settings, and on the Overview of a service nobody added (`inSheet` false).
 */
export function DownloadedModelsSection({
  service,
  scan,
  inSheet = true,
}: {
  service: Service
  /** The worker's disk catalogue (`useServiceModelCatalog` with `engine: 'worker'`). */
  scan: ServiceModelCatalog | undefined
  inSheet?: boolean
}) {
  const isDraft = useConfigureDraftHost() !== null
  if (isDraft || scan?.kind !== 'worker') return null
  if (!scan.models.some((m) => m.files !== undefined)) return null

  const presets = service.config?.availableModels ?? []
  const labelOf = (model: string) =>
    presets.find((m) => m.value === model)?.label ?? model
  const onDisk = scan.models.filter((m) => (m.files?.length ?? 0) > 0)
  const totalSize = onDisk.reduce((sum, m) => sum + (m.size ?? 0), 0)

  // The models the open instance loads — the saved one and the one its
  // process was started with: deleting either pulls files from under it.
  const instanceLabel = service.label ?? service.name
  const isRunning = service.status === 'online' || service.status === 'starting'
  const runs = new Set(
    isRunning
      ? [getEffectiveModel(service).name, service.applied?.model]
          .flatMap((names) => (names ?? '').split(','))
          .map((id) => id.trim())
      : [],
  )
  const blocked = onDisk.filter((m) => runs.has(m.name))

  return (
    <ConfigSection
      title="Downloaded models"
      aside={
        onDisk.length > 0 && (
          <span
            className="text-muted-foreground text-xs"
            data-testid="downloaded-models-total"
          >
            {formatBytes(totalSize)}
          </span>
        )
      }
      data-testid="downloaded-models-section"
    >
      {onDisk.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No model of {service.name} is on disk yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {onDisk.map((model) => {
            const label = labelOf(model.name)
            return (
              <li
                key={model.name}
                data-testid={`downloaded-model-${model.name}`}
                className="bg-card flex items-center gap-2 rounded-md border p-2 text-xs"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-medium" title={label}>
                      {label}
                    </span>
                    {!model.downloaded && (
                      <Badge
                        variant="outline"
                        className="px-1.5 py-0 text-xs"
                        data-testid="downloaded-model-partial"
                      >
                        Partial
                      </Badge>
                    )}
                    {runs.has(model.name) && (
                      <Badge tone="primary" className="px-1.5 py-0 text-xs">
                        In use
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground truncate">
                    {label !== model.name && `${model.name} · `}
                    {formatBytes(model.size ?? 0)}
                  </p>
                </div>
                <DeleteModelButton
                  type={service.id}
                  instanceKey={service.instanceKey}
                  model={model}
                  label={label}
                  serviceName={service.name}
                  disabled={runs.has(model.name)}
                  note={
                    inSheet
                      ? 'Unsaved settings in this sheet are not affected.'
                      : undefined
                  }
                />
              </li>
            )
          })}
        </ul>
      )}
      {blocked.length > 0 && (
        <p className="text-muted-foreground text-xs">
          Stop {instanceLabel} to delete the model it runs.
        </p>
      )}
    </ConfigSection>
  )
}
