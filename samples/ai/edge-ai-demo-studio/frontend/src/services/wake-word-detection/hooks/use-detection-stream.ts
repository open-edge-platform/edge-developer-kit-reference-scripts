// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useStoreSnapshot } from '@/services/common/demo/snapshot-store'
import { clearDetectionEvents } from '../lib/api'
import {
  type DetectionEvent,
  detectionStream,
  IDLE_LEVEL,
  type StreamSnapshot,
} from '../lib/detection-stream'

/** How long a detection is shown as just made. */
const FLASH_MS = 2_000

const IDLE_STREAM: StreamSnapshot = { events: [], level: IDLE_LEVEL }

/** Holds the instance's event stream open while `enabled`. */
export function useDetectionStream(
  apiBase: string | undefined,
  enabled: boolean,
) {
  useEffect(() => {
    if (!apiBase || !enabled) return
    return detectionStream(apiBase).retain()
  }, [apiBase, enabled])
}

/** Detection events, newest first, from the event stream while `enabled`; received ones stay. */
export function useDetectionEvents(
  apiBase: string | undefined,
  enabled: boolean,
) {
  useDetectionStream(apiBase, enabled)
  const stream = apiBase ? detectionStream(apiBase) : null
  const { events } = useStoreSnapshot(stream, IDLE_STREAM)

  const { mutate: clearEvents } = useMutation({
    mutationFn: () => clearDetectionEvents(apiBase),
    // The stream reports the clear too, but may not be open.
    onSuccess: () => stream?.clearEvents(),
  })

  return { events, latestEvent: events[0] ?? null, clearEvents }
}

/** RMS microphone level (0–1), pushed about ten times a second while `enabled`. */
export function useAudioLevel(apiBase: string | undefined, enabled: boolean) {
  useDetectionStream(apiBase, enabled)
  const stream = apiBase ? detectionStream(apiBase) : null
  const { level } = useStoreSnapshot(stream, IDLE_STREAM)
  return enabled ? level : IDLE_LEVEL
}

/** A live detection (never a stored one) for `FLASH_MS` after it arrives, else `null`. */
export function useDetectionFlash(
  apiBase: string | undefined,
  enabled: boolean,
): DetectionEvent | null {
  const [flash, setFlash] = useState<DetectionEvent | null>(null)

  useEffect(() => {
    if (!apiBase || !enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = detectionStream(apiBase).onDetection((event) => {
      setFlash(event)
      clearTimeout(timer)
      timer = setTimeout(() => setFlash(null), FLASH_MS)
    })
    return () => {
      unsubscribe()
      clearTimeout(timer)
      setFlash(null)
    }
  }, [apiBase, enabled])

  return enabled ? flash : null
}
