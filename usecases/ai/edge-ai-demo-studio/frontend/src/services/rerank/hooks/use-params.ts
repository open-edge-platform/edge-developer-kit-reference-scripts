// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import type { DemoParam } from '@/types/demo-params'

export const RERANK_DEFAULTS = {
  topN: 5,
}

export interface RerankParamValues {
  topN: number
}

export function useRerankParams(initial?: Partial<RerankParamValues>): {
  values: RerankParamValues
  params: DemoParam[]
} {
  const [topN, setTopN] = useState(initial?.topN ?? RERANK_DEFAULTS.topN)

  const values: RerankParamValues = { topN }

  const params: DemoParam[] = [
    {
      type: 'slider',
      id: 'top_n',
      label: 'Top N Results',
      value: topN,
      min: 1,
      max: 20,
      step: 1,
      onChange: setTopN,
    },
  ]

  return { values, params }
}
