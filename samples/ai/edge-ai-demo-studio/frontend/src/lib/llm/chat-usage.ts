// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Token counts of a chat answer, sent as message metadata: the browser cannot measure them. */

import type { TextStreamPart, ToolSet } from 'ai'

export interface ChatUsageMetadata {
  /**
   * Only counts the engine reported. `prefillTokens` is the prompt less what the prompt cache reused
   * (`prompt_tokens_details.cached_tokens`, sent by OVMS and llama.cpp).
   */
  usage: Record<string, number>
}

/**
 * `messageMetadata` for `toUIMessageStream`: total usage on the `finish` part. OVMS streams usage
 * only with `stream_options.include_usage`, which `createOvmsProvider` sets.
 */
export function chatUsageMetadata({
  part,
}: {
  part: TextStreamPart<ToolSet>
}): ChatUsageMetadata | undefined {
  if (part.type !== 'finish') return undefined
  const { inputTokens, outputTokens, inputTokenDetails } = part.totalUsage
  const counts = {
    inputTokens,
    outputTokens,
    prefillTokens: inputTokenDetails.noCacheTokens,
  }
  const usage: Record<string, number> = {}
  for (const [name, count] of Object.entries(counts)) {
    if (count !== undefined) usage[name] = count
  }
  return { usage }
}
