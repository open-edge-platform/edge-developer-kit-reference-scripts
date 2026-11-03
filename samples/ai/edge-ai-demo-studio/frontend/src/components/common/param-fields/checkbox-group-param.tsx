// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import type { ParamCheckboxGroup } from '@/types/demo-params'

export function CheckboxGroupParam({ param }: { param: ParamCheckboxGroup }) {
  const baseId = useId()
  const labelId = `${baseId}-label`
  return (
    <div className="space-y-2">
      <Label id={labelId} className="text-muted-foreground text-xs">
        {param.label}
      </Label>
      <div role="group" aria-labelledby={labelId} className="space-y-1.5">
        {param.options.map((o) => {
          const id = `${baseId}-${o.value}`
          return (
            <div
              key={o.value}
              className="hover:bg-accent flex items-center gap-2 rounded-md px-2 py-1.5"
            >
              <Checkbox
                id={id}
                checked={o.checked}
                onCheckedChange={(checked) =>
                  param.onChange(o.value, checked === true)
                }
              />
              <label
                htmlFor={id}
                className="text-foreground flex-1 cursor-pointer text-xs select-none"
              >
                {o.label}
              </label>
            </div>
          )
        })}
        {param.options.length === 0 && (
          <p className="text-muted-foreground text-xs">No items available</p>
        )}
      </div>
    </div>
  )
}
