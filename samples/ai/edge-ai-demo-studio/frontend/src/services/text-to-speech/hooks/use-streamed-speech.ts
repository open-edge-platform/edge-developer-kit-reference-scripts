// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect } from 'react'
import {
  demoSessionKey,
  demoStateKey,
} from '@/services/common/demo/demo-session'
import {
  useSessionResource,
  useSetSessionBusy,
} from '@/services/common/demo/session-store'
import { useStoreSnapshot } from '@/services/common/demo/snapshot-store'
import { SpeechSynthesis } from '../lib/speech-synthesis'
import type { SpeechRequestParams } from '../lib/tts-models'
import { useTtsModel } from './use-synthesize-speech'

interface UseStreamedSpeechOptions {
  /** Defaults to the service type's model. */
  model?: string
  /**
   * Under a `DemoSessionProvider`, keeps the last file and outcome per instance across remounts
   * and marks the instance busy while a request runs.
   */
  session?: { id: string; instanceKey?: string }
}

/**
 * Speech that plays while it is synthesized: WAV streams piece by piece, other formats are
 * fetched whole. Unmounting stops the request, reported as `failure.kind === 'interrupted'`.
 */
export function useStreamedSpeech(
  apiBase: string | undefined,
  options?: UseStreamedSpeechOptions,
) {
  const typeModel = useTtsModel()
  const model = options?.model ?? typeModel
  const session = options?.session
  const setSessionBusy = useSetSessionBusy()
  const speech = useSessionResource(
    session ? demoStateKey(session, 'tts:speech') : undefined,
    () =>
      new SpeechSynthesis((pending) => {
        if (session) setSessionBusy(demoSessionKey(session), pending)
      }),
    (kept) => kept.dispose(),
  )
  const { pending, playback, result, failure } = useStoreSnapshot(speech)

  useEffect(() => speech.stop, [speech])

  return {
    synthesize: (params: SpeechRequestParams) =>
      speech.synthesize(apiBase, model, params),
    stop: speech.stop,
    pause: speech.pause,
    resume: speech.resume,
    position: speech.position,
    playback,
    isPending: pending !== null,
    error: failure?.kind === 'error' ? failure.error : null,
    pending,
    result,
    failure,
  }
}
