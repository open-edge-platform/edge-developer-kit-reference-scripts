// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import type { DemoParam } from '@/types/demo-params'

export const EMBEDDINGS_DEFAULTS = {
  encodingFormat: 'float',
}

export const ENCODING_FORMAT_OPTIONS = [
  { value: 'float', label: 'Float' },
  { value: 'base64', label: 'Base64' },
]

export interface EmbeddingsParamValues {
  encodingFormat: string
}

export function useEmbeddingsParams(initial?: Partial<EmbeddingsParamValues>): {
  values: EmbeddingsParamValues
  params: DemoParam[]
} {
  const [encodingFormat, setEncodingFormat] = useState(
    initial?.encodingFormat ?? EMBEDDINGS_DEFAULTS.encodingFormat,
  )

  const values: EmbeddingsParamValues = { encodingFormat }

  const params: DemoParam[] = [
    {
      type: 'select',
      id: 'encoding_format',
      label: 'Encoding Format',
      value: encodingFormat,
      options: ENCODING_FORMAT_OPTIONS,
      onChange: setEncodingFormat,
    },
  ]

  return { values, params }
}
