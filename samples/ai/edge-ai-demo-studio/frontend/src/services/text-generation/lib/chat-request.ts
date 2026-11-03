// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { RequestParams, TextGenParamValues } from '../hooks/use-params'

/** AI SDK UI message stream route. */
export const CHAT_API = '/api/services/text-generation/chat'

/** The chat route's body for these settings, before sample instances and feature fields. */
export function chatRequestBody(
  values: TextGenParamValues,
  requestParams: RequestParams,
) {
  return {
    ...requestParams,
    ...(values.systemPrompt.trim()
      ? { systemPrompt: values.systemPrompt.trim() }
      : {}),
    disableReasoning: values.disableReasoning,
    reasoningParser: values.reasoningParser,
  }
}
