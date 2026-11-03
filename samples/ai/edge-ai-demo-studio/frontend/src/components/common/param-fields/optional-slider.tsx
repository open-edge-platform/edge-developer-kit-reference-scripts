// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { RotateCcw } from 'lucide-react'
import { useId } from 'react'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import type { ParamSlider } from '@/types/demo-params'
import { ParamLabel } from './param-label'
import { SliderNumberInput } from './slider-number-input'

/**
 * A slider the request may leave out: "Default" until the user turns on
 * Custom, which reveals the slider and a numeric field.
 */
export function OptionalSlider({ param }: { param: ParamSlider }) {
  const isCustom = param.unset === false
  const labelId = useId()
  return (
    <div className="space-y-2" data-testid={`param-${param.id}`}>
      <div className="flex items-center justify-between gap-2">
        <ParamLabel label={param.label} tooltip={param.tooltip} id={labelId} />
        <div className="flex shrink-0 items-center gap-2">
          {!isCustom && (
            <span className="text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5 text-xs">
              Default
            </span>
          )}
          <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs">
            Custom
            <Switch
              size="sm"
              aria-label={`Custom ${param.label}`}
              checked={isCustom}
              onCheckedChange={(checked) => {
                if (checked) param.onChange(param.value)
                else param.onReset?.()
              }}
            />
          </label>
        </div>
      </div>
      {isCustom && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <Slider
              aria-labelledby={labelId}
              value={[param.value]}
              min={param.min}
              max={param.max}
              step={param.step}
              onValueChange={([v]) => param.onChange(v)}
              className="flex-1"
            />
            <SliderNumberInput param={param} />
          </div>
          <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
            <span className="tabular-nums">
              {param.min}–{param.max}
              {param.unit ? ` ${param.unit}` : ''}
            </span>
            {param.onReset && (
              <button
                type="button"
                onClick={param.onReset}
                className="hover:text-foreground -my-1 flex min-h-8 items-center gap-1 rounded px-1 transition-colors"
              >
                <RotateCcw aria-hidden="true" className="h-3 w-3" />
                Use default
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
