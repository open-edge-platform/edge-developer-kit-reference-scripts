// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useId, useState } from 'react'
import type { SettingDescriptions } from '@/components/configure/applied-settings'
import {
  ConfigSection,
  LabelWithTooltip,
} from '@/components/configure/config-section'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { getServiceMetadata } from '@/lib/instances/service-metadata'
import { WorkerConfigurePanel } from '@/services/common/configure/worker-configure-panel'
import type { WorkerConfigurePanelProps } from '@/services/common/configure/worker-configure-panel-props'

/** No value of its own: the worker's per-device default. */
const AUTO = 'auto'

const BATCH_SIZES = ['8', '16', '32', '64', '128']

const PERFORMANCE_MODES = [
  { value: 'LATENCY', label: 'Latency — answer each request soonest' },
  { value: 'THROUGHPUT', label: 'Throughput — most inputs per second' },
]

const SETTING_DESCRIPTIONS: SettingDescriptions = {
  'metadata.embeddingBatchSize': {
    label: 'Batch size',
    unset: 'Auto',
  },
  'metadata.performanceMode': {
    label: 'Performance hint',
    format: (mode) => mode.charAt(0) + mode.slice(1).toLowerCase(),
    unset: 'Auto',
  },
  'metadata.compiledModelCache': {
    label: 'Compiled model cache',
    format: (on) => (on === 'true' ? 'On' : 'Off'),
  },
}

interface TuningDraft {
  batchSize: string
  performanceMode: string
  modelCache: boolean
}

function TuningSection({
  draft,
  onChange,
}: {
  draft: TuningDraft
  onChange: (patch: Partial<TuningDraft>) => void
}) {
  const fieldId = useId()
  // A size saved elsewhere (deployment.json) is listed too, so the trigger shows what is saved.
  const sizes =
    draft.batchSize === AUTO || BATCH_SIZES.includes(draft.batchSize)
      ? BATCH_SIZES
      : [...BATCH_SIZES, draft.batchSize]
  return (
    <ConfigSection title="Inference Tuning" data-testid="cfg-oep-tuning">
      <div className="space-y-2">
        <LabelWithTooltip
          label="Batch size"
          htmlFor={`${fieldId}-batch`}
          tooltip="Inputs embedded per inference. Larger batches embed long document lists faster on a GPU; the NPU keeps its fixed batch of 16."
        />
        <Select
          value={draft.batchSize}
          onValueChange={(batchSize) => onChange({ batchSize })}
        >
          <SelectTrigger
            id={`${fieldId}-batch`}
            data-testid="cfg-oep-batch-size"
            className="w-full text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTO} className="text-xs">
              Auto (64 on GPU, 16 otherwise)
            </SelectItem>
            {sizes.map((size) => (
              <SelectItem key={size} value={size} className="text-xs">
                {size} inputs
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <LabelWithTooltip
          label="Performance hint"
          htmlFor={`${fieldId}-hint`}
          tooltip="The OpenVINO performance hint the model is compiled with."
        />
        <Select
          value={draft.performanceMode}
          onValueChange={(performanceMode) => onChange({ performanceMode })}
        >
          <SelectTrigger
            id={`${fieldId}-hint`}
            data-testid="cfg-oep-performance-mode"
            className="w-full text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTO} className="text-xs">
              Auto (throughput on GPU, latency otherwise)
            </SelectItem>
            {PERFORMANCE_MODES.map((m) => (
              <SelectItem key={m.value} value={m.value} className="text-xs">
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <Label
            htmlFor={`${fieldId}-cache`}
            className="text-muted-foreground text-xs"
          >
            Cache the compiled model
          </Label>
          <p className="text-muted-foreground text-xs">
            Restarts on CPU and GPU skip compiling. The NPU always caches.
          </p>
        </div>
        <Switch
          id={`${fieldId}-cache`}
          data-testid="cfg-oep-model-cache"
          checked={draft.modelCache}
          onCheckedChange={(modelCache) => onChange({ modelCache })}
        />
      </div>
    </ConfigSection>
  )
}

/** The worker panel on OEP models, with the worker's inference tuning under Advanced. */
export function OepEmbeddingsWorkerPanel(props: WorkerConfigurePanelProps) {
  const metadata = getServiceMetadata(props.service)
  const saved: TuningDraft = {
    batchSize:
      typeof metadata.embeddingBatchSize === 'number'
        ? String(metadata.embeddingBatchSize)
        : AUTO,
    performanceMode: metadata.performanceMode ?? AUTO,
    modelCache: metadata.compiledModelCache === true,
  }
  const [draft, setDraft] = useState(saved)
  const changed = {
    embeddingBatchSize: draft.batchSize !== saved.batchSize,
    performanceMode: draft.performanceMode !== saved.performanceMode,
    compiledModelCache: draft.modelCache !== saved.modelCache,
  }
  // null clears a key: the worker's default applies again.
  const update = {
    ...(changed.embeddingBatchSize && {
      embeddingBatchSize:
        draft.batchSize === AUTO ? null : Number(draft.batchSize),
    }),
    ...(changed.performanceMode && {
      performanceMode:
        draft.performanceMode === AUTO ? null : draft.performanceMode,
    }),
    ...(changed.compiledModelCache && {
      compiledModelCache: draft.modelCache || null,
    }),
  }
  const anyChanged = Object.keys(update).length > 0

  return (
    <WorkerConfigurePanel
      {...props}
      settingDescriptions={SETTING_DESCRIPTIONS}
      extension={{
        changed: anyChanged,
        reset: () => setDraft(saved),
        config: anyChanged ? { metadata: update } : undefined,
      }}
      advanced={
        <TuningSection
          draft={draft}
          onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
        />
      }
    />
  )
}
