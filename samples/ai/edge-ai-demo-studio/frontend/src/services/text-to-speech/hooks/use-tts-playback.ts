// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useState } from 'react'
import { useServiceApiBase } from '@/context/service-status-context'
import {
  SnapshotStore,
  useStoreSnapshot,
} from '@/services/common/demo/snapshot-store'
import { useSpeechSynthesizer } from './use-synthesize-speech'

/** Reads chat messages aloud one at a time; the snapshot is the id being read, or `null`. */
class MessageSpeech extends SnapshotStore<string | null> {
  private controller: AbortController | null = null
  private audio: HTMLAudioElement | null = null
  private url: string | null = null

  constructor() {
    super(null)
  }

  /** Reads `msgId`, or stops it if it is being read. Anything else being read stops first. */
  toggle(msgId: string, synthesize: (signal: AbortSignal) => Promise<Blob>) {
    const wasReading = this.snapshot === msgId
    this.stop()
    if (wasReading) return

    const controller = new AbortController()
    this.controller = controller
    this.setSnapshot(msgId)
    const settle = () => {
      if (this.controller === controller) this.stop()
    }
    synthesize(controller.signal)
      .then((blob) => {
        if (this.controller !== controller) return
        this.url = URL.createObjectURL(blob)
        const audio = new Audio(this.url)
        this.audio = audio
        audio.onended = settle
        return audio.play()
      })
      // A failed synthesis, or a play the browser refuses, ends the reading.
      .catch(settle)
  }

  stop() {
    this.controller?.abort()
    this.controller = null
    if (this.audio) {
      this.audio.onended = null
      this.audio.pause()
      this.audio = null
    }
    if (this.url) URL.revokeObjectURL(this.url)
    this.url = null
    this.setSnapshot(null)
  }
}

interface UseTtsPlaybackOptions {
  voice?: string
  speed?: number
}

/** `handleSpeak(text, msgId)` toggles reading a chat message aloud; unmounting stops it. */
export function useTtsPlayback({
  voice = 'af_heart',
  speed = 1.0,
}: UseTtsPlaybackOptions = {}) {
  const apiBase = useServiceApiBase('text-to-speech')
  const synthesize = useSpeechSynthesizer(apiBase)
  const [speech] = useState(() => new MessageSpeech())
  const speakingMsgId = useStoreSnapshot(speech)

  useEffect(() => () => speech.stop(), [speech])

  const handleSpeak = (text: string, msgId: string) =>
    speech.toggle(msgId, (signal) =>
      synthesize({ input: text, voice, speed, responseFormat: 'mp3' }, signal),
    )

  return { speakingMsgId, handleSpeak }
}
