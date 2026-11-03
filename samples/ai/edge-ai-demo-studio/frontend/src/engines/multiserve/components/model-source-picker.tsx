// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { MODEL_SOURCE_OPTIONS, type ModelSource } from '@/types/common'

/** The registry a model is pulled from: one toggle button per source. */
export function ModelSourcePicker({
  value,
  onChange,
}: {
  value: ModelSource
  onChange: (source: ModelSource) => void
}) {
  const labelId = useId()
  return (
    <div className="space-y-2">
      <p id={labelId} className="text-muted-foreground text-xs font-medium">
        Source
      </p>
      <div
        data-testid="cfg-source-select"
        role="group"
        aria-labelledby={labelId}
        className="flex flex-wrap gap-1.5"
      >
        {MODEL_SOURCE_OPTIONS.map(({ value: option, label }) => {
          const isSelected = value === option
          return (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={isSelected ? 'default' : 'outline'}
              aria-pressed={isSelected}
              onClick={() => onChange(option)}
              className={cn(
                'h-7 px-3 text-xs transition-all',
                isSelected && 'ring-ring ring-1 ring-offset-0',
              )}
            >
              {label}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
