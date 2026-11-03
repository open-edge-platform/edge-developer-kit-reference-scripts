// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { siblingWorkerAddress } from '@/lib/instances/instances'
import { logger } from '@/lib/logger'
import { getWorkloadEndpoint } from '@/lib/workers/instance-lookup'

/** Speaks a chat answer through the lipsync avatar, sentence by sentence, while it streams. */

export interface LipsyncConfig {
  sessionId: string
  voice: string
  speed: string
  frameGeneration?: boolean
}

interface LipsyncUrls {
  lipsyncBase: string
  /** The TTS instance's address on the app, for the lipsync worker to call. */
  ttsUrl?: string
}

/**
 * Lipsync base URL and (best-effort) TTS address, from the live rows, never from the client (SSRF).
 * Null when lipsync isn't running; a stopped TTS just omits `tts_url`.
 */
export async function resolveLipsyncUrls(
  lipsyncInstanceKey?: string,
  ttsInstanceKey?: string,
): Promise<LipsyncUrls | null> {
  let lipsyncBase: string
  try {
    lipsyncBase = (await getWorkloadEndpoint('lipsync', lipsyncInstanceKey))
      .baseUrl
  } catch (error) {
    logger.error('Lipsync dispatch skipped — lipsync is not running:', error)
    return null
  }

  const ttsUrl = await getWorkloadEndpoint('text-to-speech', ttsInstanceKey)
    .then(({ instanceKey }) => siblingWorkerAddress(instanceKey))
    .catch(() => undefined)

  return { lipsyncBase, ttsUrl }
}

export interface LipsyncForwarder {
  /** Queues a sentence; returns at once, so the token stream never waits. */
  send(sentence: string): void
  /** Drops the sentences not sent yet and stops the avatar speaking. */
  stop(): Promise<void>
}

async function postToLipsync(url: string, body: object): Promise<void> {
  const res = await fetch(new URL(url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  await res.body?.cancel()
  if (!res.ok) throw new Error(`Lipsync answered HTTP ${res.status}`)
}

/**
 * One per chat request. Each sentence POST waits for the previous one: two fired together could
 * reach the avatar's speech queue swapped.
 */
export function createLipsyncForwarder(
  lipsync: LipsyncConfig,
  { lipsyncBase, ttsUrl }: LipsyncUrls,
): LipsyncForwarder {
  let chain = Promise.resolve()
  let stopped = false
  return {
    send(sentence) {
      chain = chain.then(async () => {
        if (stopped) return
        await postToLipsync(`${lipsyncBase}/v1/lipsync/chat`, {
          text: sentence,
          session_id: lipsync.sessionId,
          chat_type: 'echo',
          voice: lipsync.voice,
          speed: lipsync.speed,
          frame_generation: lipsync.frameGeneration ?? false,
          ...(ttsUrl ? { tts_url: ttsUrl } : {}),
        }).catch((err) => {
          logger.error('Failed to dispatch sentence to lipsync:', err)
        })
      })
    },
    stop() {
      if (stopped) return chain
      stopped = true
      // After the sentence already on its way, so the stop also clears it.
      chain = chain.then(() =>
        postToLipsync(`${lipsyncBase}/v1/lipsync/stop`, {
          session_id: lipsync.sessionId,
          chat_type: 'stop',
        }).catch((err) => {
          logger.error('Failed to stop lipsync:', err)
        }),
      )
      return chain
    },
  }
}
