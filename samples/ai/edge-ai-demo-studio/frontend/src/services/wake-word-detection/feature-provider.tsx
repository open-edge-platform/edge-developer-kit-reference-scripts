// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback } from 'react'
import {
  useFeatureHandles,
  useFeaturePublish,
  useSingletonGroup,
} from '@/context/feature-collector'
import { useWakeWordTrigger } from './hooks/use-wake-word-trigger'

/**
 * Headless feature provider for the optional wake-word integration. Publishes
 * the Wake Word config group and, on detection, calls the `stt.startRecording`
 * handle exposed by the speech-to-text provider (a no-op when STT is excluded).
 * See docs/OPTIONAL-SERVICES.md.
 */
export function WakeWordFeatureProvider() {
  const { getHandle } = useFeatureHandles()

  const onWakeWord = useCallback(() => {
    getHandle('stt.startRecording')?.()
  }, [getHandle])

  const wakeWord = useWakeWordTrigger({ onWakeWord })

  const groups = useSingletonGroup(wakeWord.group)

  useFeaturePublish('wake-word-detection', { groups })

  return null
}
