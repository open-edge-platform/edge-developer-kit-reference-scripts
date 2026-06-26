// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useServiceLiveStatus } from '@/context/service-status-context'
import { type DetectionEvent, useDetectionEvents } from './use-detection-events'
import { useQuickStart } from './use-quick-start'
import type { ServiceParamGroup } from '@/types/demo-params'

interface UseWakeWordTriggerOptions {
  onWakeWord: (event: DetectionEvent) => void
  threshold?: number
}

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

  // Memoized so the wake-word feature provider can publish it through the
  // collector without re-render churn (see docs/OPTIONAL-SERVICES.md).
  const group: ServiceParamGroup = useMemo(
    () => ({
      serviceLabel: 'Wake Word Detection',
      serviceId: 'wake-word-detection',
      online,
      optional: true,
      offlineMessage:
        'Enable wake word detection for hands-free interaction. Start the service from the services page.',
      enabled,
      onToggle: setEnabled,
      params: [],
    }),
    [online, enabled],
  )

  return { enabled: active, online, group }
}
