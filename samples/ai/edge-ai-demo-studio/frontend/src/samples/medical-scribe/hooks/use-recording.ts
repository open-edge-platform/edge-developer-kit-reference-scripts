// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMediaRecorder } from '@/hooks/use-media-recorder'

/** The shared `useMediaRecorder`, narrowed to the start/stop/clear surface this sample needs. */
export function useRecording() {
  const { isRecording, start, stop, clear } = useMediaRecorder({
    mimeType: 'audio/webm',
    timesliceMs: 1000,
  })

  const startRecording = async () => {
    const { timeOrigin } = await start()
    return timeOrigin
  }

  return {
    isRecording,
    startRecording,
    stopRecording: stop,
    clearAudio: clear,
  }
}
