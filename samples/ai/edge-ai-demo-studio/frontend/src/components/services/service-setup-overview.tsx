// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ChevronRight, FileText, Plus } from 'lucide-react'
import { useState } from 'react'
import { TruncatedText } from '@/components/common/truncated-text'
import { CollapsibleSection } from '@/components/configure/collapsible-section'
import { FactRow } from '@/components/services/fact-row'
import { NewInstanceSheet } from '@/components/services/new-instance-sheet'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { useServiceStatus } from '@/context/service-status-context'
import {
  type ServiceModelCatalog,
  useServiceModelCatalog,
} from '@/hooks/use-model-catalog'
import { formatBytes } from '@/lib/browser/format'
import { instanceLimit } from '@/lib/instances/service-presentation'
import type { WorkerCatalogModel } from '@/lib/workers/model-catalog'
import type { Service as PayloadService } from '@/payload-types'
import { ClearModelCacheSection } from '@/services/common/configure/clear-model-cache-section'
import { DownloadedModelsSection } from '@/services/common/configure/downloaded-models-section'
import type { ModelOption, Service } from '@/services/types'
import {
  getExecutionModeOptions,
  getExecutionModes,
  hasExecutionMode,
  resolveExecutionMode,
} from '@/services/execution'
import { describeFirstStart } from './new-instance-copy'
import { findModelOption, useModelDownload } from './new-instance-downloads'
import { FactValue } from './new-instance-sections'
import {
  RequirementItem,
  SetupRequirementItems,
} from './new-instance-requirements'

function presetNotes(option: ModelOption): string[] {
  const notes: string[] = []
  if (option.gated?.includes('huggingface')) {
    notes.push('Needs Hugging Face access')
  }
  if (option.weight === 'heavy') notes.push('Large download')
  return notes
}

/**
 * Every model the service can be set up with, folded. Ones already on disk show their size;
 * Maintenance below deletes them.
 */
function ModelCatalogue({
  presets,
  recommended,
  onDisk,
}: {
  presets: ModelOption[]
  recommended: string | undefined
  /** The presets with files on disk, by model id. */
  onDisk: Map<string, WorkerCatalogModel>
}) {
  const diskSize = [...onDisk.values()].reduce(
    (sum, m) => sum + (m.size ?? 0),
    0,
  )
  return (
    <Collapsible className="group/models border-border rounded-xl border">
      <CollapsibleTrigger
        className="hover:bg-muted/40 focus-visible:ring-ring/50 flex min-h-11 w-full items-center gap-2 rounded-xl px-4 py-2.5 text-left outline-none focus-visible:ring-[3px]"
        data-testid="setup-overview-models-toggle"
      >
        <ChevronRight
          aria-hidden="true"
          className="text-muted-foreground h-4 w-4 shrink-0 transition-transform duration-150 group-data-[state=open]/models:rotate-90"
        />
        <span className="text-foreground text-sm font-medium">
          Models to choose from
        </span>
        <span
          className="text-muted-foreground ml-auto text-xs"
          data-testid="setup-overview-models-count"
        >
          {presets.length}
          {onDisk.size > 0 &&
            ` · ${onDisk.size} on disk, ${formatBytes(diskSize)}`}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-border border-t">
        <ul
          className="divide-border divide-y"
          data-testid="setup-overview-models"
        >
          {presets.map((option) => {
            const notes = presetNotes(option)
            if (option.value === recommended) notes.unshift('Recommended')
            const stored = onDisk.get(option.value)
            return (
              <li
                key={option.value}
                className="flex items-start gap-3 px-4 py-2.5"
                data-testid={`setup-overview-model-${option.value}`}
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-foreground text-sm">{option.label}</p>
                  <TruncatedText
                    text={option.value}
                    className="text-muted-foreground font-mono text-xs"
                  />
                  {notes.length > 0 && (
                    <p className="text-muted-foreground text-xs">
                      {notes.join(' · ')}
                    </p>
                  )}
                </div>
                {stored && (
                  <span
                    className="text-muted-foreground shrink-0 text-xs"
                    data-testid="setup-overview-model-on-disk"
                  >
                    {stored.downloaded ? 'On disk' : 'Partial download'} ·{' '}
                    {formatBytes(stored.size ?? 0)}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * The Maintenance of Runtime Settings for a service nobody added: models an earlier setup left on
 * disk can be deleted one at a time, or the whole cache cleared, without adding the service first.
 */
function OverviewMaintenance({
  service,
  scan,
}: {
  service: Service
  scan: ServiceModelCatalog | undefined
}) {
  const [open, setOpen] = useState(false)
  return (
    <CollapsibleSection
      title="Maintenance"
      note="Acts immediately"
      open={open}
      onOpenChange={setOpen}
      testId="setup-overview-maintenance"
    >
      <p className="text-muted-foreground px-2 text-xs">
        These actions take effect as soon as you confirm them.
      </p>
      <DownloadedModelsSection service={service} scan={scan} inSheet={false} />
      <ClearModelCacheSection service={service} inSheet={false} />
    </CollapsibleSection>
  )
}

/** What a service page shows before the service is added: the recommended setup and its needs. */
export function ServiceSetupOverview({
  service,
  onShowDocs,
  onAdded,
}: {
  service: Service
  onShowDocs: () => void
  onAdded?: (instance: PayloadService) => void
}) {
  const { services } = useServiceStatus()
  const recommended = service.defaultModel
  const recommendedOption = findModelOption(service, recommended?.name)
  const modes = getExecutionModes(service.execution)
  const engine =
    modes.length > 1 ? getExecutionModeOptions(service.execution)[0] : undefined
  const download = useModelDownload({
    service,
    instanceKey: service.id,
    engine: resolveExecutionMode(service.execution, service.engine),
    model: recommended?.name,
    checkDisk: false,
  })
  const presets = service.config?.availableModels ?? []
  // Scanned once (the page may stay open long); only a worker reports its presets' files. A
  // worker with models has Maintenance here, as its Runtime Settings would.
  const hasMaintenance =
    presets.length > 0 && hasExecutionMode(service.execution, 'worker')
  const { data: scan } = useServiceModelCatalog(service.id, {
    engine: 'worker',
    enabled: hasMaintenance,
    poll: false,
  })
  const onDisk = new Map(
    scan?.kind === 'worker'
      ? scan.models
          .filter((m) => (m.files?.length ?? 0) > 0)
          .map((m) => [m.name, m] as const)
      : [],
  )
  const devices = service.config?.availableDevices ?? []
  const prerequisites = (service.prerequisiteServices ?? [])
    .map((id) => services.find((s) => s.id === id)?.name)
    .filter((name): name is string => Boolean(name))
  const max = instanceLimit(service)
  // With no default but presets to pick from, nothing is claimed.
  const firstStart = download
    ? describeFirstStart({ downloads: [download] })
    : presets.length === 0
      ? describeFirstStart({ downloads: [] })
      : undefined

  return (
    <section
      aria-labelledby="service-setup-title"
      className="glass-card space-y-6 rounded-2xl p-5 sm:p-6"
      data-testid="service-setup-overview"
    >
      <div className="max-w-3xl space-y-2">
        <h2
          id="service-setup-title"
          className="text-foreground text-lg font-semibold tracking-tight"
        >
          Set up {service.name}
        </h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {service.longDescription || service.description}
        </p>
        <p className="text-foreground text-sm">
          An instance runs this service with its own{' '}
          {recommended ? 'model and device' : 'settings'}. Add the service to
          create its first one.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="border-border space-y-3 rounded-xl border p-4">
          <h3 className="text-foreground text-sm font-semibold">
            Recommended setup
          </h3>
          <dl className="space-y-2" data-testid="setup-overview-facts">
            {recommended && (
              <FactRow
                label="Model"
                value={
                  <TruncatedText
                    text={recommended.name}
                    className="ml-auto w-fit max-w-full font-mono text-xs"
                  />
                }
              />
            )}
            {recommended?.device && (
              <FactRow
                label="Device"
                value={<FactValue text={recommended.device} />}
              />
            )}
            {engine && (
              <FactRow
                label="Engine"
                value={<FactValue text={engine.label} />}
              />
            )}
            {recommended?.backend && (
              <FactRow
                label="Backend"
                value={<FactValue text={recommended.backend} />}
              />
            )}
            {devices.length > 0 && (
              <FactRow
                label="Supported devices"
                value={<FactValue text={devices.join(', ')} />}
              />
            )}
            {prerequisites.length > 0 && (
              <FactRow
                label="Works with"
                value={<FactValue text={prerequisites.join(', ')} />}
              />
            )}
            <FactRow
              label="Instances"
              value={<FactValue text={max > 1 ? `Up to ${max}` : 'One'} />}
            />
          </dl>
          {recommendedOption &&
            recommendedOption.label !== recommended?.name && (
              <p className="text-muted-foreground text-xs leading-relaxed">
                {recommendedOption.label}
              </p>
            )}
          <p className="text-muted-foreground text-xs leading-relaxed">
            {recommended
              ? 'You can change the model and device while adding it, or later in Configure.'
              : 'Its settings are chosen while adding it and can be changed later in Configure.'}
          </p>
        </div>

        <div className="border-border space-y-3 rounded-xl border p-4">
          <h3 className="text-foreground text-sm font-semibold">
            Before you start
          </h3>
          <ul className="space-y-2.5" data-testid="setup-overview-requirements">
            {firstStart && (
              <RequirementItem status="info">{firstStart.text}</RequirementItem>
            )}
            <SetupRequirementItems
              service={service}
              model={recommended?.name}
            />
            <RequirementItem status="info">
              The demo and logs become available once the service is added.
            </RequirementItem>
          </ul>
        </div>
      </div>

      {(presets.length > 1 || onDisk.size > 0) && (
        <ModelCatalogue
          presets={presets}
          recommended={recommended?.name}
          onDisk={onDisk}
        />
      )}

      {hasMaintenance && <OverviewMaintenance service={service} scan={scan} />}

      <div className="space-y-3">
        <p
          className="text-muted-foreground max-w-3xl text-sm"
          data-testid="setup-overview-next"
        >
          Add service opens a short form with this setup filled in. Nothing is
          created or downloaded until you confirm it there.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <NewInstanceSheet
            serviceType={service.id}
            onCreated={onAdded}
            trigger={
              <Button data-testid="setup-overview-add">
                <Plus />
                Add service
              </Button>
            }
          />
          <Button
            variant="outline"
            onClick={onShowDocs}
            data-testid="setup-overview-docs"
          >
            <FileText />
            Read documentation
          </Button>
        </div>
      </div>
    </section>
  )
}
