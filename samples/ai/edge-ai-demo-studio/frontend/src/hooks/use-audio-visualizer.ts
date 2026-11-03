// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useRef, useState } from 'react'

export interface UseAudioVisualizerOptions {
  /** Number of bars to compute. Default 24. */
  barCount?: number
  /** `AnalyserNode.fftSize`. Default 64. */
  fftSize?: number
  /** Smoothing factor applied to each bar per frame (0-1). Default 0.3. */
  smoothing?: number
  /** Bar height floor. Default 4. */
  minLevel?: number
  /** Extra height added on top of `minLevel` at full volume. Default 52. */
  maxLevel?: number
}

/** Bar heights visualizing a live `MediaStream`; a flat `minLevel` row when it is null. */
export function useAudioVisualizer(
  stream: MediaStream | null,
  options: UseAudioVisualizerOptions = {},
) {
  const {
    barCount = 24,
    fftSize = 64,
    smoothing = 0.3,
    minLevel = 4,
    maxLevel = 52,
  } = options

  const [levels, setLevels] = useState<number[]>(() =>
    Array(barCount).fill(minLevel),
  )
  const animFrameRef = useRef<number | null>(null)

  useEffect(() => {
    if (!stream) return

    const audioContext = new AudioContext()
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = fftSize
    audioContext.createMediaStreamSource(stream).connect(analyser)
    const smoothedData = new Float32Array(barCount)
    const binCount = analyser.frequencyBinCount

    const loop = () => {
      const freqData = new Uint8Array(binCount)
      analyser.getByteFrequencyData(freqData)
      const heights: number[] = []
      for (let i = 0; i < barCount; i++) {
        const startBin = Math.floor((i * binCount) / barCount)
        const endBin = Math.max(
          startBin + 1,
          Math.floor(((i + 1) * binCount) / barCount),
        )
        let sum = 0
        for (let b = startBin; b < endBin; b++) sum += freqData[b]
        const avg = sum / (endBin - startBin)
        smoothedData[i] += (avg - smoothedData[i]) * smoothing
        heights.push(minLevel + (smoothedData[i] / 255) * maxLevel)
      }
      setLevels(heights)
      animFrameRef.current = requestAnimationFrame(loop)
    }
    animFrameRef.current = requestAnimationFrame(loop)

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current)
        animFrameRef.current = null
      }
      audioContext.close()
      // So the next recording's first frame doesn't show this run's last bars.
      setLevels(Array(barCount).fill(minLevel))
    }
  }, [stream, barCount, fftSize, smoothing, minLevel, maxLevel])

  return { levels: stream ? levels : Array(barCount).fill(minLevel) }
}
