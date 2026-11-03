// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

/**
 * OpenAI-compatible provider for an OVMS (or llama.cpp) chat model, with a hook to patch the request
 * body (e.g. repetition penalty, disabling thinking).
 */
export function createOvmsProvider(options: {
  baseUrl: string
  patchBody?: (body: Record<string, unknown>) => void
}) {
  const { baseUrl, patchBody } = options
  return createOpenAICompatible({
    baseURL: `${baseUrl}/v1`,
    name: 'ovms',
    // OVMS reports streaming token counts only in this final `usage` chunk; llama.cpp accepts it too.
    includeUsage: true,
    fetch: async (url, fetchOptions) => {
      if (fetchOptions?.body && patchBody) {
        const body = JSON.parse(fetchOptions.body.toString())
        patchBody(body)
        fetchOptions = { ...fetchOptions, body: JSON.stringify(body) }
      }
      return fetch(new URL(url.toString()), fetchOptions)
    },
  })
}
