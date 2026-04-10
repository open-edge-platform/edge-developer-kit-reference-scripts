// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useRef, useState } from 'react'
import { useServiceLiveStatus } from '@/context/service-status-context'
import {
  type DetectionEvent,
  useDetectionEvents,
} from '@/services/wake-word-detection/hooks/use-detection-events'
import { useQuickStart } from '@/services/wake-word-detection/hooks/use-quick-start'
import type { ServiceParamGroup } from '../components/demo-config-sheet'

interface UseWakeWordTriggerOptions {
  /** Called once when a wake word is detected */
  onWakeWord: (event: DetectionEvent) => void
  /** Minimum score to accept a detection (default: 0.5) */
  threshold?: number
}

/**
 * Reusable hook that monitors the wake-word-detection service and fires a
 * callback when a wake word is detected. Automatically starts detection
 * when the service is online and the feature is enabled.
 *
 * Returns a `ServiceParamGroup` for the configure sheet so any sample can
 * include wake-word settings in its sidebar.
 */
export function useWakeWordTrigger({
  onWakeWord,
  threshold = 0.5,
}: UseWakeWordTriggerOptions) {
  const [enabled, setEnabled] = useState(true)
  const online = useServiceLiveStatus('wake-word-detection') === 'online'
  const active = online && enabled

  const quickStart = useQuickStart()
  const { latestEvent, resetSince } = useDetectionEvents(active)

  // Track the last-handled event timestamp to avoid duplicate triggers
  const handledRef = useRef<string | null>(null)

  // Auto-start detection when the service comes online and is enabled
  const startedRef = useRef(false)
  useEffect(() => {
    if (active && !startedRef.current) {
      startedRef.current = true
      resetSince()
      quickStart.mutate({ threshold })
    }
    if (!active) {
      startedRef.current = false
    }
  }, [active, quickStart, threshold, resetSince])

  // Fire the callback when a new detection event arrives
  useEffect(() => {
    if (!active || !latestEvent) return
    if (latestEvent.timestamp === handledRef.current) return
    if (latestEvent.score < threshold) return

    handledRef.current = latestEvent.timestamp
    onWakeWord(latestEvent)
  }, [active, latestEvent, threshold, onWakeWord])

  const group: ServiceParamGroup = {
    serviceLabel: 'Wake Word Detection',
    serviceId: 'wake-word-detection',
    online,
    optional: true,
    offlineMessage:
      'Enable wake word detection for hands-free interaction. Start the service from the services page.',
    enabled,
    onToggle: setEnabled,
    params: [],
  }

  return { enabled: active, online, group }
}
