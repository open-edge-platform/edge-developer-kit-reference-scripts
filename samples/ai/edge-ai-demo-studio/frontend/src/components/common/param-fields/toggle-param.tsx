// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useId } from 'react'
import { Switch } from '@/components/ui/switch'
import type { ParamToggle } from '@/types/demo-params'
import { ParamLabel } from './param-label'

export function ToggleParam({ param }: { param: ParamToggle }) {
  const id = useId()
  return (
    <div className="flex items-center justify-between">
      <ParamLabel label={param.label} tooltip={param.tooltip} htmlFor={id} />
      <Switch
        id={id}
        checked={param.checked}
        onCheckedChange={param.onChange}
      />
    </div>
  )
}
