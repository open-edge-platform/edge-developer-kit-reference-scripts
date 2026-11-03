// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ConfigSection } from '@/components/configure/config-section'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  isModelSource,
  type ModelSource,
  type SelectOption,
} from '@/types/common'
import type { ModelSourceType } from './use-worker-model-draft'

/** Where a worker panel's model comes from: preset or custom id, and the registry it is pulled from. */
export function ModelSourceSection({
  fieldId,
  supportsCustom,
  sourceType,
  onSourceTypeChange,
  sources,
  source,
  onSourceChange,
}: {
  /** The panel's `useId()`, prefixing the group label ids. */
  fieldId: string
  supportsCustom: boolean
  sourceType: ModelSourceType
  onSourceTypeChange: (type: ModelSourceType) => void
  /** The registries offered; none hides the Source group. */
  sources: SelectOption[]
  source: ModelSource
  onSourceChange: (source: ModelSource) => void
}) {
  return (
    <ConfigSection title="Model source">
      {supportsCustom && (
        <div className="space-y-2">
          <p
            id={`${fieldId}-from`}
            className="text-muted-foreground text-xs leading-none font-medium"
          >
            Model from
          </p>
          <div
            role="group"
            aria-labelledby={`${fieldId}-from`}
            className="grid grid-cols-2 gap-2"
          >
            {(['preset', 'custom'] as const).map((type) => (
              <Button
                key={type}
                data-testid={`source-${type}-button`}
                type="button"
                size="sm"
                variant={sourceType === type ? 'default' : 'outline'}
                aria-pressed={sourceType === type}
                onClick={() => onSourceTypeChange(type)}
              >
                {type === 'preset' ? 'Preset' : 'Custom'}
              </Button>
            ))}
          </div>
        </div>
      )}
      {sources.length > 0 && (
        <div className="space-y-2">
          <p
            id={`${fieldId}-source`}
            className="text-muted-foreground text-xs leading-none font-medium"
          >
            Source
          </p>
          <div
            data-testid="cfg-source-select"
            role="group"
            aria-labelledby={`${fieldId}-source`}
            className="flex flex-wrap gap-1.5"
          >
            {sources.map((s) => {
              const isSelected = source === s.value
              return (
                <Button
                  key={s.value}
                  type="button"
                  size="sm"
                  variant={isSelected ? 'default' : 'outline'}
                  aria-pressed={isSelected}
                  onClick={() => {
                    if (isModelSource(s.value)) onSourceChange(s.value)
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
    </ConfigSection>
  )
}
