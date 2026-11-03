// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useEffectEvent, useMemo } from 'react'
import {
  useFeatureHandles,
  useFeaturePublish,
  useSingletonGroup,
} from '@/context/feature-collector'
import type { VoiceInputControls } from '@/context/voice-input-context'
import { useOptionalServiceGroup } from '@/hooks/use-optional-service-group'
import { useSttRecording } from './hooks/use-stt-recording'

const noop = () => {}

/**
 * Headless provider for optional STT: publishes its config group, `sttOnline` and `voiceInput`
 * controls for the chat mic button, and registers the `stt.startRecording` handle for wake word.
 */
export function SttFeatureProvider({
  onTranscription,
}: {
  onTranscription?: (text: string) => void
}) {
  const optional = useOptionalServiceGroup({
    serviceId: 'speech-to-text',
    serviceLabel: 'Speech to Text',
    offlineMessage:
      'Enable STT for voice input. Start the service from the services page.',
  })
  const stt = useSttRecording({ onTranscription: onTranscription ?? noop })
  const { setHandle } = useFeatureHandles()

  // Kept stable: the collector re-registers the provider whenever `exports` changes identity.
  const voiceInput: VoiceInputControls = useMemo(
    () => ({
      isRecording: stt.isRecording,
      isPending: stt.isPending,
      micError: stt.micError,
      startRecording: stt.startRecording,
      stopRecording: stt.stopRecording,
    }),
    [
      stt.isRecording,
      stt.isPending,
      stt.micError,
      stt.startRecording,
      stt.stopRecording,
    ],
  )

  const groups = useSingletonGroup(optional.group)
  const exports = useMemo(
    () => ({ voiceInput, sttOnline: optional.enabled }),
    [voiceInput, optional.enabled],
  )

  // Effect event: reads the current recording state without re-registering the handle.
  const startUnlessRecording = useEffectEvent(() => {
    if (!stt.isRecording) stt.startRecording()
  })
  useEffect(() => {
    setHandle('stt.startRecording', () => startUnlessRecording())
    return () => setHandle('stt.startRecording', null)
  }, [setHandle])

  useFeaturePublish('speech-to-text', { groups, exports })

  return null
}
