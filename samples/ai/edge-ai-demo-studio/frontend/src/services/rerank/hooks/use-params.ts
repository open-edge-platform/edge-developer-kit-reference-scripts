// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useDemoParams } from '@/services/common/demo/use-demo-params'
import type { DemoParam } from '@/types/demo-params'

const RERANK_DEFAULTS = {
  topN: 5,
}

export interface RerankParamValues {
  topN: number
}

/** The rerank demo's parameters, kept per instance for the page visit under `sessionKey`. */
export function useRerankParams({
  sessionKey,
  initial,
}: { sessionKey?: string; initial?: Partial<RerankParamValues> } = {}): {
  values: RerankParamValues
  params: DemoParam[]
} {
  const { values, setters } = useDemoParams(RERANK_DEFAULTS, {
    sessionKey,
    initial,
  })

  const params: DemoParam[] = [
    {
      type: 'slider',
      id: 'top_n',
      label: 'Top N Results',
      value: values.topN,
      min: 1,
      max: 20,
      step: 1,
      onChange: setters.setTopN,
    },
  ]

  return { values, params }
}
