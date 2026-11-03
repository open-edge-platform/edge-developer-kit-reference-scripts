// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useQuery } from '@tanstack/react-query'

/** What the browser can tell about a chosen video before it is uploaded. */
export interface VideoMetadata {
  /** Seconds; `null` when the container does not say (some live recordings). */
  durationS: number | null
  /** Frames per second, when the browser could measure it. */
  fps: number | null
  width: number
  height: number
}

/** Frames timed to measure the frame rate. */
const SAMPLE_FRAMES = 12
/** How long measuring may take before the frames seen so far are used. */
const MEASURE_TIMEOUT_MS = 3_000
/** How long the browser may take to read the container's header. */
const METADATA_TIMEOUT_MS = 10_000

/** Frame rates videos are usually encoded at; a measurement this close is one of them. */
const COMMON_RATES = [
  23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88, 120,
]

/** The common rate closest to `fps` within 1 %, else `fps` to two decimals. */
function snapFps(fps: number): number {
  const closest = COMMON_RATES.reduce((best, rate) =>
    Math.abs(rate - fps) < Math.abs(best - fps) ? rate : best,
  )
  return Math.abs(closest - fps) / closest < 0.01
    ? closest
    : Math.round(fps * 100) / 100
}

/**
 * A skipped frame shows as a gap of two or more frame durations, so the shortest gap seen at least
 * twice (within 5 %) is one frame.
 */
function fpsFromMediaTimes(times: number[]): number | null {
  const gaps: number[] = []
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1]
    if (gap > 0.001) gaps.push(gap)
  }
  gaps.sort((a, b) => a - b)
  const frame = gaps.find(
    (gap) => gaps.filter((g) => Math.abs(g - gap) / gap < 0.05).length >= 2,
  )
  return frame ? snapFps(1 / frame) : null
}

function waitFor(
  video: HTMLVideoElement,
  event: 'loadedmetadata',
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (error?: Error) => {
      clearTimeout(timer)
      video.removeEventListener(event, onEvent)
      video.removeEventListener('error', onError)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }
    const onEvent = () => done()
    const onError = () => done(new Error('The browser cannot read this video'))
    const onAbort = () => done(new Error('Cancelled'))
    const timer = setTimeout(
      () => done(new Error('Reading the video took too long')),
      METADATA_TIMEOUT_MS,
    )
    video.addEventListener(event, onEvent)
    video.addEventListener('error', onError)
    signal?.addEventListener('abort', onAbort)
  })
}

/** Times the frames of a brief muted playback; `null` without frame callbacks or playback. */
function measureFps(
  video: HTMLVideoElement,
  signal: AbortSignal | undefined,
): Promise<number | null> {
  if (typeof video.requestVideoFrameCallback !== 'function') {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    const times: number[] = []
    let handle = 0
    let settled = false
    const finish = (fps: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      video.cancelVideoFrameCallback(handle)
      signal?.removeEventListener('abort', onAbort)
      resolve(fps)
    }
    const onAbort = () => finish(null)
    const timer = setTimeout(
      () => finish(fpsFromMediaTimes(times)),
      MEASURE_TIMEOUT_MS,
    )
    const onFrame: VideoFrameRequestCallback = (_now, frame) => {
      times.push(frame.mediaTime)
      if (times.length >= SAMPLE_FRAMES) finish(fpsFromMediaTimes(times))
      else handle = video.requestVideoFrameCallback(onFrame)
    }
    handle = video.requestVideoFrameCallback(onFrame)
    signal?.addEventListener('abort', onAbort)
    video.play().catch(() => finish(null))
  })
}

/**
 * The invisible element is attached to the document because frames are only presented, and so
 * timed, for an element in the document.
 */
async function readVideoMetadata(
  file: File,
  signal?: AbortSignal,
): Promise<VideoMetadata> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.setAttribute('aria-hidden', 'true')
  Object.assign(video.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '2px',
    height: '2px',
    opacity: '0',
    pointerEvents: 'none',
  })
  document.body.appendChild(video)
  try {
    const loaded = waitFor(video, 'loadedmetadata', signal)
    video.src = url
    await loaded
    const durationS = Number.isFinite(video.duration) ? video.duration : null
    const fps = await measureFps(video, signal)
    return {
      durationS,
      fps,
      width: video.videoWidth,
      height: video.videoHeight,
    }
  } finally {
    video.pause()
    video.removeAttribute('src')
    video.load()
    video.remove()
    URL.revokeObjectURL(url)
  }
}

/** Read once per file. An error means this browser cannot read the video; the worker may still. */
export function useVideoMetadata(file: File | null) {
  return useQuery({
    queryKey: [
      'frame-generation',
      'video-metadata',
      file?.name,
      file?.size,
      file?.lastModified,
    ],
    enabled: file !== null,
    queryFn: ({ signal }) => {
      if (!file) throw new Error('No video chosen')
      return readVideoMetadata(file, signal)
    },
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: false,
  })
}
