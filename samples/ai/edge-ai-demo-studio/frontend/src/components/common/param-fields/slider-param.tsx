// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { RotateCcw } from 'lucide-react'
import { useId } from 'react'
import { Slider } from '@/components/ui/slider'
import type { ParamSlider } from '@/types/demo-params'
import { OptionalSlider } from './optional-slider'
import { ParamLabel } from './param-label'

/**
 * A numeric param as a slider with its value and a reset; one the request
 * may leave out (`unset` given) is an {@link OptionalSlider}.
 */
export function SliderParam({ param }: { param: ParamSlider }) {
  const labelId = useId()
  if (param.unset !== undefined) return <OptionalSlider param={param} />
  return (
    <div className="space-y-2" data-testid={`param-${param.id}`}>
      <div className="flex items-center justify-between">
        <ParamLabel label={param.label} tooltip={param.tooltip} id={labelId} />
        <div className="flex items-center gap-1">
          <span className="text-foreground bg-muted/50 rounded px-1.5 py-0.5 font-mono text-xs">
            {param.value}
          </span>
          {param.onReset && (
            <button
              type="button"
              aria-label={`Reset ${param.label} to default`}
              onClick={param.onReset}
              // A 32px target that keeps the label row's height.
              className="hover:bg-muted/20 text-muted-foreground -my-1.5 flex h-8 w-8 items-center justify-center rounded"
            >
              <RotateCcw aria-hidden="true" className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      <Slider
        aria-labelledby={labelId}
        value={[param.value]}
        min={param.min}
        max={param.max}
        step={param.step}
        onValueChange={([v]) => param.onChange(v)}
      />
    </div>
  )
}
