// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { type RefObject, useEffect, useState } from 'react'
import { requireApiBase } from '@/lib/browser/api-base'
import {
  fetchCameraStatus,
  reloadCamera,
  ROBOTICS_SERVICE,
  roboticsKey,
} from '../lib/api'

/** Rejects anything that isn't a plain http(s) URL before it lands in an `img.src`. */
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url, 'http://127.0.0.1')
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** Wait before re-opening a stream that failed, so a worker still coming back isn't hammered. */
const STREAM_RETRY_MS = 2000

/**
 * MJPEG camera stream state, status polling, reconnecting and reload. `imgRef` is owned by the
 * component rendering the `<img>`: a ref must not travel inside a returned object (`react-hooks/refs`).
 */
export function useRoboticsCamera(
  workerBaseUrl: string | undefined,
  imgRef: RefObject<HTMLImageElement | null>,
) {
  const [isConnected, setIsConnected] = useState(false)
  // Failed stream loads since the last successful one. Bumped on every error,
  // so a stream that fails again while already disconnected is retried too.
  const [streamFailures, setStreamFailures] = useState(0)

  const { data: cameraStatus } = useQuery({
    queryKey: roboticsKey('camera-status', workerBaseUrl),
    queryFn: () => {
      requireApiBase(workerBaseUrl, ROBOTICS_SERVICE)
      return fetchCameraStatus(workerBaseUrl)
    },
    enabled: !isConnected && workerBaseUrl !== undefined,
    refetchInterval: 1000,
    retry: false,
  })
  const reload = useMutation({
    mutationFn: () => {
      requireApiBase(workerBaseUrl, ROBOTICS_SERVICE)
      return reloadCamera(workerBaseUrl)
    },
  })

  // Reopen the stream once the camera is ready; after a failure, wait out the retry delay first.
  useEffect(() => {
    if (isConnected || !cameraStatus?.ready) return
    const timer = setTimeout(
      () => {
        const img = imgRef.current
        if (!img || !workerBaseUrl || !isSafeUrl(workerBaseUrl)) return
        img.src = `${workerBaseUrl}/stream/camera?ts=${Date.now()}`
      },
      streamFailures > 0 ? STREAM_RETRY_MS : 0,
    )
    return () => clearTimeout(timer)
  }, [isConnected, cameraStatus, streamFailures, imgRef, workerBaseUrl])

  return {
    isConnected,
    handleStreamLoad: () => {
      setIsConnected(true)
      setStreamFailures(0)
    },
    /** The stream `<img>`'s `onError`: marks it disconnected and reconnects. */
    handleStreamError: () => {
      setIsConnected(false)
      setStreamFailures((n) => n + 1)
    },
    statusMessage: isConnected
      ? ''
      : reload.isPending
        ? 'Reloading camera…'
        : reload.isError
          ? `Failed to reload camera: ${reload.error.message}`
          : 'Waiting for camera…',
    isReloading: reload.isPending,
    reload: () => {
      if (reload.isPending) return
      setIsConnected(false)
      reload.mutate()
    },
  }
}
