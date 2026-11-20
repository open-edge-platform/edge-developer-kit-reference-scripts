// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** Output scales a model offers: its own, and smaller ones (its output resized down, Lanczos). */
function outscaleOptions(scale: number): string[] {
  return scale >= 4 ? ['2', '3', '4'] : ['1.5', '2']
}

/** The saved scale if this model offers it, else the model's own. */
export function effectiveOutscale(saved: string, scale: number): string {
  return outscaleOptions(scale).includes(saved) ? saved : String(scale)
}

export function OutscaleSelect({
  id,
  scale,
  value,
  onChange,
  disabled,
}: {
  id: string
  /** The model's own factor. */
  scale: number
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-muted-foreground text-xs">
        Output scale
      </Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} data-testid={id} className="w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {outscaleOptions(scale).map((s) => (
            <SelectItem key={s} value={s} className="text-xs">
              {s}×{Number(s) === scale ? ' (model)' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
