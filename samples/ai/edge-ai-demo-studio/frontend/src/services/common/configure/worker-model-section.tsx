// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Upload } from 'lucide-react'
import type { ReactNode } from 'react'
import { ConfigSection } from '@/components/configure/config-section'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ModelOption } from '@/services/types'
import { DownloadedBadge, ModelCatalogSummary } from './model-catalog-note'
import type { WorkerModelCatalog } from './use-worker-model-catalog'
import type { ModelSourceType } from './use-worker-model-draft'

/** A worker panel's Model section: the preset list, or the model id field in custom mode. */
export function WorkerModelSection({
  fieldId,
  sourceType,
  presets,
  model,
  onModelChange,
  customModel,
  onCustomModelChange,
  catalog,
  listPresetsBy,
  modelSelectId,
  modelSelectTestId,
  renderModelHint,
  note,
}: {
  /** The panel's `useId()`, prefixing the field ids. */
  fieldId: string
  sourceType: ModelSourceType
  presets: ModelOption[]
  /** The drafted preset. */
  model: string
  onModelChange: (model: string) => void
  customModel: string
  onCustomModelChange: (model: string) => void
  catalog: WorkerModelCatalog
  listPresetsBy: 'value' | 'label'
  modelSelectId?: string
  modelSelectTestId: string
  renderModelHint?: (option: ModelOption) => ReactNode
  /** Under the model field, for the drafted model. */
  note?: ReactNode
}) {
  const selectedPreset = presets.find((m) => m.value === model)

  return (
    <ConfigSection title="Model">
      {sourceType === 'preset' && presets.length > 0 && (
        <div className="space-y-2">
          <Label
            htmlFor={modelSelectId ?? `${fieldId}-model`}
            className="text-muted-foreground text-xs"
          >
            Model
          </Label>
          <Select value={model} onValueChange={onModelChange}>
            <SelectTrigger
              data-testid={modelSelectTestId}
              id={modelSelectId ?? `${fieldId}-model`}
              className="w-full text-xs"
            >
              {/* Without children, Radix copies the selected item (badge, hint and all) into
                  the trigger; the plain name keeps those in the list only. */}
              <SelectValue>
                {listPresetsBy === 'label'
                  ? (selectedPreset?.label ?? model)
                  : model}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {presets.map((m) => (
                <SelectItem
                  key={m.value}
                  value={m.value}
                  textValue={listPresetsBy === 'label' ? m.label : m.value}
                  className="text-xs"
                >
                  <span className="flex flex-col items-start gap-0.5">
                    <span className="flex items-center gap-1.5">
                      {listPresetsBy === 'label' ? m.label : m.value}
                      {catalog.isDownloaded(m.value) && (
                        <DownloadedBadge model={m.value} />
                      )}
                    </span>
                    {renderModelHint && (
                      <span className="text-muted-foreground text-xs font-normal">
                        {renderModelHint(m)}
                      </span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ModelCatalogSummary catalog={catalog} />
        </div>
      )}

      {sourceType === 'custom' && (
        <div className="space-y-2">
          <Label
            htmlFor={`${fieldId}-custom`}
            className="text-muted-foreground text-xs"
          >
            <Upload className="mr-1 inline-block h-3 w-3" />
            Model ID (e.g. org/model-name)
          </Label>
          <Input
            id={`${fieldId}-custom`}
            data-testid="cfg-custom-model"
            value={customModel}
            onChange={(e) => onCustomModelChange(e.target.value)}
            placeholder="openai/whisper-large-v3"
            className="text-xs"
            aria-invalid={!customModel.trim() || undefined}
          />
          {!customModel.trim() && (
            <p className="text-destructive text-xs">
              Enter a model ID, or switch back to a preset.
            </p>
          )}
        </div>
      )}

      {note}
    </ConfigSection>
  )
}
