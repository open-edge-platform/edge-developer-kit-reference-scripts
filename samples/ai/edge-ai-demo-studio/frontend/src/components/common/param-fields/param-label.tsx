// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { InfoTip } from '@/components/common/info-tip'
import { Label } from '@/components/ui/label'

/**
 * A param's label with its info tip. `htmlFor` ties the label to a native
 * control; `id` lets a custom one (a slider thumb) reference it instead.
 */
export function ParamLabel({
  label,
  tooltip,
  id,
  htmlFor,
}: {
  label: string
  tooltip?: string
  id?: string
  htmlFor?: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Label
        id={id}
        htmlFor={htmlFor}
        className="text-muted-foreground text-xs"
      >
        {label}
      </Label>
      <InfoTip tooltip={tooltip} ariaLabel={`About ${label}`} />
    </div>
  )
}
