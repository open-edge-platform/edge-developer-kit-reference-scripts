// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useOptionalServiceGroup } from '@/hooks/use-optional-service-group'
import {
  type TextGenParamValues,
  useTextGenParams,
} from '@/services/text-generation/hooks/use-params'

interface UseTextGenerationParamsOptions {
  initial?: Partial<TextGenParamValues>
  optional?: boolean
  systemPromptTooltip?: string
}

export function useTextGenerationParams(
  options?: UseTextGenerationParamsOptions,
) {
  const { initial, optional = false, systemPromptTooltip } = options ?? {}
  const { values, requestParams, params } = useTextGenParams(initial, {
    systemPromptTooltip,
  })

  const { group } = useOptionalServiceGroup({
    serviceId: 'text-generation',
    serviceLabel: 'Text Generation',
    optional,
    params,
  })

  return { values, requestParams, group }
}
