// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import { useServiceLiveStatus } from '@/context/service-status-context'
import {
  type TextGenParamValues,
  useTextGenParams,
} from '@/services/text-generation/hooks/use-params'
import { ServiceParamGroup } from '../components/demo-config-sheet'

export type { TextGenParamValues as TextGenerationParams }

interface UseTextGenerationParamsOptions {
  initial?: Partial<TextGenParamValues>
  optional?: boolean
}

export function useTextGenerationParams(
  options?: UseTextGenerationParamsOptions,
) {
  const { initial, optional = false } = options ?? {}
  const { values, requestParams, params } = useTextGenParams(initial)
  const [enabled, setEnabled] = useState(true)

  const online = useServiceLiveStatus('text-generation') === 'online'

  const group: ServiceParamGroup = {
    serviceLabel: 'Text Generation',
    serviceId: 'text-generation',
    online,
    optional,
    ...(optional
      ? {
          enabled,
          onToggle: setEnabled,
        }
      : {}),
    params,
  }

  return { values, requestParams, group }
}
