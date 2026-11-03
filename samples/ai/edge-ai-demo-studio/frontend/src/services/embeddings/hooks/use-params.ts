// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { DemoParam } from '@/types/demo-params'
import { useDemoParams } from '@/services/common/demo/use-demo-params'

const EMBEDDINGS_DEFAULTS = {
  encodingFormat: 'float',
}

const ENCODING_FORMAT_OPTIONS = [
  { value: 'float', label: 'Float' },
  { value: 'base64', label: 'Base64' },
]

/** Embeddings demo settings; with `sessionKey` they are kept per instance while the page is open. */
export function useEmbeddingsParams({ sessionKey }: { sessionKey?: string }) {
  const { values, setters } = useDemoParams(EMBEDDINGS_DEFAULTS, { sessionKey })

  const params: DemoParam[] = [
    {
      type: 'select',
      id: 'encoding_format',
      label: 'Encoding Format',
      value: values.encodingFormat,
      options: ENCODING_FORMAT_OPTIONS,
      onChange: setters.setEncodingFormat,
    },
  ]

  return { values, params }
}
