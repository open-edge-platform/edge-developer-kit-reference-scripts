// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useMemo, useRef } from 'react'
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
 * Headless feature provider for the optional speech-to-text integration. Owns
 * the recording state and publishes: its config group, the `sttOnline` flag,
 * and `voiceInput` controls so chat UI (e.g. conversation-panel, via
 * VoiceInputContext) can render the mic button. Also registers a guarded
 * `stt.startRecording` handle the wake-word provider calls.
 * See docs/OPTIONAL-SERVICES.md.
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

  // Expose a guarded start to the wake-word provider via the handle bus — only
  // starts a new recording when not already recording (mirrors the former
  // use-wake-word-stt wiring). The ref keeps the guard current without
  // re-registering on every recording-state change.
  const { isRecording, startRecording } = stt
  const isRecordingRef = useRef(isRecording)
  useEffect(() => {
    isRecordingRef.current = isRecording
  }, [isRecording])
  useEffect(() => {
    const triggerStart = () => {
      if (!isRecordingRef.current) startRecording()
    }
    setHandle('stt.startRecording', triggerStart)
    return () => setHandle('stt.startRecording', null)
  }, [setHandle, startRecording])

  useFeaturePublish('speech-to-text', { groups, exports })

  return null
}
