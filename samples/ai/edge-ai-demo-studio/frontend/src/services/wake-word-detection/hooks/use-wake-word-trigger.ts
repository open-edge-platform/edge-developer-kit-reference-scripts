// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useEffectEvent, useRef } from 'react'
import { toast } from 'sonner'
import { useServiceApiBase } from '@/context/service-status-context'
import { useOptionalServiceGroup } from '@/hooks/use-optional-service-group'
import { type DetectionEvent, detectionStream } from '../lib/detection-stream'
import { useStartDetection } from './use-detection-control'
import { useDetectionStream } from './use-detection-stream'

// A wake word scores above the threshold for several 80 ms chunks in a row;
// detections this close after the last one handled are the same utterance.
const TRIGGER_COOLDOWN_MS = 1_000

interface UseWakeWordTriggerOptions {
  onWakeWord: (event: DetectionEvent) => void
  threshold?: number
}

/**
 * Wake word as a sample feature: while online and enabled, starts detection and calls `onWakeWord`
 * once per utterance above `threshold`. Returns the feature's parameter group with its toggle.
 */
export function useWakeWordTrigger({
  onWakeWord,
  threshold = 0.5,
}: UseWakeWordTriggerOptions) {
  // Headless feature provider, so it targets the type's primary instance.
  const apiBase = useServiceApiBase('wake-word-detection')
  const {
    enabled: active,
    online,
    group,
  } = useOptionalServiceGroup({
    serviceId: 'wake-word-detection',
    serviceLabel: 'Wake Word Detection',
    offlineMessage:
      'Enable wake word detection for hands-free interaction. Start the service from the services page.',
  })

  const {
    mutate: startDetection,
    error: startError,
    reset: resetStart,
  } = useStartDetection(apiBase)
  useDetectionStream(apiBase, active)

  // Start once each time the service comes online and enabled. A failed start (no server mic)
  // toasts once and stays for the group to show until a retry or the feature is switched off.
  const startedRef = useRef(false)
  useEffect(() => {
    if (active && !startedRef.current) {
      startedRef.current = true
      startDetection(
        { threshold },
        {
          onError: (error) =>
            toast.error('Wake word detection could not start', {
              description: error.message,
            }),
        },
      )
    }
    if (!active) {
      startedRef.current = false
      resetStart()
    }
  }, [active, startDetection, resetStart, threshold])
  const retryStart = () => {
    resetStart()
    startDetection({ threshold })
  }

  // Live detections only, never the ones stored before this page connected.
  const lastFiredRef = useRef(0)
  const handleDetection = useEffectEvent((event: DetectionEvent) => {
    if (event.score < threshold) return
    const now = Date.now()
    if (now - lastFiredRef.current < TRIGGER_COOLDOWN_MS) return
    lastFiredRef.current = now
    onWakeWord(event)
  })
  useEffect(() => {
    if (!apiBase || !active) return
    return detectionStream(apiBase).onDetection((event) =>
      handleDetection(event),
    )
  }, [apiBase, active])

  return {
    enabled: active,
    online,
    group,
    /** Why detection did not start, while it has not. */
    startError: active ? startError : null,
    retryStart,
  }
}
