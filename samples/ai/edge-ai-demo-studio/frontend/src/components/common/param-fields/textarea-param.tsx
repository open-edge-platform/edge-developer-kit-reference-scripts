// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useId } from 'react'
import { Textarea } from '@/components/ui/textarea'
import type { ParamTextarea } from '@/types/demo-params'
import { ParamLabel } from './param-label'

export function TextareaParam({ param }: { param: ParamTextarea }) {
  const id = useId()
  return (
    <div className="space-y-2" data-testid={`param-${param.id}`}>
      <ParamLabel label={param.label} tooltip={param.tooltip} htmlFor={id} />
      <Textarea
        id={id}
        value={param.value}
        onChange={(e) => param.onChange(e.target.value)}
        placeholder={param.placeholder}
        rows={param.rows ?? 3}
        className="bg-muted/30 resize-none text-xs"
      />
    </div>
  )
}
