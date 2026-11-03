// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { DemoParam } from '@/types/demo-params'
import { CheckboxGroupParam } from './param-fields/checkbox-group-param'
import { InfoListParam } from './param-fields/info-list-param'
import { SelectParam } from './param-fields/select-param'
import { SliderParam } from './param-fields/slider-param'
import { TextareaParam } from './param-fields/textarea-param'
import { ToggleParam } from './param-fields/toggle-param'

export function ParamRenderer({ param }: { param: DemoParam }) {
  switch (param.type) {
    case 'info-list':
      return <InfoListParam param={param} />
    case 'slider':
      return <SliderParam param={param} />
    case 'checkbox-group':
      return <CheckboxGroupParam param={param} />
    case 'textarea':
      return <TextareaParam param={param} />
    case 'toggle':
      return <ToggleParam param={param} />
    case 'select':
      return <SelectParam param={param} />
    default:
      return null
  }
}
