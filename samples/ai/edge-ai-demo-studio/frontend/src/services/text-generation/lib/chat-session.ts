// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Chat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { getInstanceApiBase, parseInstanceKey } from '@/lib/instances/instances'
import type { ChatUsageMetadata } from '@/lib/llm/chat-usage'
import { safeUrl, URL_CHARS } from '@/lib/validation'
import { startWork, type WorkTimer } from '@/services/common/metrics/work'
import { withOutcome } from './chat-helpers'
import { CHAT_API } from './chat-request'

/** Unreleased object URLs of draft image previews. */
export class PreviewUrls {
  private urls = new Set<string>()

  create(file: File): string {
    const url = URL.createObjectURL(file)
    this.urls.add(url)
    return url
  }

  revoke(url: string) {
    URL.revokeObjectURL(url)
    this.urls.delete(url)
  }

  revokeAll() {
    this.urls.forEach((url) => URL.revokeObjectURL(url))
    this.urls.clear()
  }
}

/**
 * A stream event carrying the model's first output. Safe to match on raw text: serialized JSON
 * has no other unescaped `"type":"…"` than the event's own.
 */
const FIRST_OUTPUT_EVENT =
  /"type":"(?:text-delta|reasoning-delta|tool-input-start)"/

function watchFirstOutput(res: Response, onFirstOutput: () => void): Response {
  if (!res.body) return res
  const decoder = new TextDecoder()
  let seen = false
  let tail = ''
  const body = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (!seen) {
          const text = tail + decoder.decode(chunk, { stream: true })
          seen = FIRST_OUTPUT_EVENT.test(text)
          if (seen) onFirstOutput()
          // An event can be split across chunks.
          tail = text.slice(-40)
        }
        controller.enqueue(chunk)
      },
    }),
  )
  return new Response(body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  })
}

/**
 * A conversation that can outlive its component in the demo session, so a response keeps
 * streaming while another instance is shown. With `instanceKey`, each response is measured for
 * that instance's Live metrics; one that ends early is marked with its outcome.
 */
export function createChat(
  instanceKey: string | undefined,
  onSettled: () => void,
): Chat<UIMessage> {
  const instance = instanceKey ? parseInstanceKey(instanceKey) : null
  const apiBase = instance ? getInstanceApiBase(instance) : undefined
  // The response being streamed; the chat sends one at a time.
  let timer: WorkTimer | null = null
  const transport = new DefaultChatTransport({
    api: CHAT_API,
    fetch: apiBase
      ? async (input, init) => {
          const raw = input instanceof Request ? input.url : String(input)
          let target = ''
          for (const ch of safeUrl(raw)) {
            let ok = ''
            for (const allowed of URL_CHARS)
              if (allowed === ch) {
                ok = allowed
                break
              }
            if (!ok) throw new Error('Forbidden character in URL')
            target += ok
          }
          const safeInput =
            input instanceof Request ? new Request(target, input) : target
          const call = startWork(apiBase)
          timer = call
          try {
            const res = await fetch(safeInput, init)
            return watchFirstOutput(res, () => call.firstOutput())
          } catch (error) {
            call.settleError(init?.signal)
            throw error
          }
        }
      : undefined,
  })
  const chat: Chat<UIMessage> = new Chat<UIMessage>({
    transport,
    // Called for every started request: completed, aborted or failed (after onError).
    onFinish: ({ message, isAbort, isError }) => {
      onSettled()
      const call = timer
      timer = null
      if (isAbort) call?.aborted()
      else if (isError) call?.failed()
      else {
        const metadata = message.metadata as ChatUsageMetadata | undefined
        call?.finish({ quantities: metadata?.usage })
      }
      if (!isAbort && !isError) return
      const marked = withOutcome(
        chat.messages,
        message.id,
        isAbort ? 'stopped' : 'interrupted',
      )
      if (marked !== chat.messages) chat.messages = marked
    },
  })
  return chat
}
