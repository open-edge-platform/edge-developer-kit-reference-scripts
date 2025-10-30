// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react'

export default function useAudioRecorder() {
  const MIN_DECIBELS = -45
  const VISUALIZER_BUFFER_LENGTH = 300

  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
  const [recording, setRecording] = useState(false)
  const chunks = useRef<Blob[]>([])
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const [durationCounter, setDurationCounter] = useState<NodeJS.Timeout | null>(
    null,
  )
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [visualizerData, setVisualizerData] = useState(
    Array(VISUALIZER_BUFFER_LENGTH).fill(0),
  )
  const [isDeviceFound, setIsDeviceFound] = useState(false)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const hasSoundRef = useRef<boolean>(false)

  // Function to calculate the RMS level from time domain data
  const calculateRMS = (data: Uint8Array) => {
    let sumSquares = 0
    for (let i = 0; i < data.length; i++) {
      const normalizedValue = (data[i] - 128) / 128 // Normalize the data
      sumSquares += normalizedValue * normalizedValue
    }
    return Math.sqrt(sumSquares / data.length)
  }

  const normalizeRMS = (rms: number) => {
    rms = rms * 10
    const exp = 1.5 // Adjust exponent value
    const scaledRMS = Math.pow(rms, exp)
    // Scale between 0.01 (1%) and 1.0 (100%)
    return Math.min(1.0, Math.max(0.01, scaledRMS))
  }

  const analyseAudio = useCallback(() => {
    if (!analyser) return

    const bufferLength = analyser.frequencyBinCount
    const domainData = new Uint8Array(bufferLength)
    const timeDomainData = new Uint8Array(analyser.fftSize)

    // Clear any existing animation frame before starting a new one
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    const detectSound = () => {
      const processFrame = () => {
        if (!recording) {
          // Cancel animation frame if no longer recording
          animationFrameRef.current = null
          return
        }

        analyser.getByteTimeDomainData(timeDomainData)
        analyser.getByteFrequencyData(domainData)

        // Calculate RMS level from time domain data
        const rmsLevel = calculateRMS(timeDomainData)
        // Push the calculated decibel level to visualizerData
        setVisualizerData((prev) => {
          if (prev.length >= VISUALIZER_BUFFER_LENGTH) {
            prev.shift()
          }
          return [...prev, normalizeRMS(rmsLevel)]
        })

        // Check if sound is detected
        const hasSound = domainData.some((value) => value > 0)
        if (hasSound) {
          hasSoundRef.current = true
        }

        // Store the animation frame ID for cleanup
        animationFrameRef.current = window.requestAnimationFrame(processFrame)
      }

      // Start the animation frame and store the ID
      animationFrameRef.current = window.requestAnimationFrame(processFrame)
    }

    detectSound()

    // Return cleanup function that cancels any active animation frame
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [analyser, recording])

  const initiateMediaRecoder = useCallback(
    (stream: MediaStream) => {
      const wavRecorder = new MediaRecorder(stream)

      // Event handler when recording starts
      wavRecorder.onstart = () => {
        chunks.current = [] // Resetting chunks array
      }

      // Event handler when data becomes available during recording
      wavRecorder.ondataavailable = (ev: BlobEvent) => {
        chunks.current.push(ev.data) // Storing data chunks
      }

      // Event handler when recording stops
      wavRecorder.onstop = () => {
        const mimeType = wavRecorder.mimeType
        const audioBlob = new Blob(chunks.current, { type: mimeType })
        if (chunks.current.length > 0) {
          setAudioBlob(audioBlob)
        }
        setRecording(false)
      }

      setMediaRecorder(wavRecorder)

      // Analyzer to activate only on certain noise level
      const audioCtx = new AudioContext()
      const sourceAnalyser = audioCtx.createAnalyser()
      const source = audioCtx.createMediaStreamSource(stream)
      source.connect(sourceAnalyser)
      sourceAnalyser.minDecibels = MIN_DECIBELS
      setAnalyser(sourceAnalyser)

      setIsDeviceFound(true)
    },
    [MIN_DECIBELS],
  )

  const startRecording = useCallback(() => {
    hasSoundRef.current = false
    const startDurationCounter = () => {
      setDurationCounter(
        setInterval(() => {
          setDurationSeconds((prev) => prev + 1)
        }, 1000),
      )
    }

    try {
      if (mediaRecorder) {
        mediaRecorder.start()
        startDurationCounter()
        setRecording(true)
      }
    } catch (error) {
      setIsDeviceFound(false)
      console.error('Error recording audio:', error)
    }

    setVisualizerData(Array(VISUALIZER_BUFFER_LENGTH).fill(0))
  }, [mediaRecorder])

  const stopRecording = useCallback(() => {
    const stopDurationCounter = () => {
      if (durationCounter !== null) {
        clearInterval(durationCounter)
      }
      setDurationSeconds(0)
    }

    if (mediaRecorder) {
      stopDurationCounter()
      mediaRecorder.stop()
    }
  }, [durationCounter, mediaRecorder])

  const clearRecording = useCallback(() => {
    setAudioBlob(null)
  }, [])

  useEffect(() => {
    async function loadRecorder(): Promise<void> {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        })
        navigator.mediaDevices.ondevicechange = () => {
          setIsDeviceFound(false)
        }
        initiateMediaRecoder(stream)
      } catch (error) {
        setIsDeviceFound(false)
        console.error('Error accessing microphone:', error)
      }
    }

    if (typeof window !== 'undefined' && !mediaRecorder) {
      loadRecorder()
    }
  }, [mediaRecorder, initiateMediaRecoder])

  useEffect(() => {
    if (recording) {
      const cleanup = analyseAudio()
      return cleanup
    }
  }, [analyseAudio, recording])

  // Add cleanup to stop animation frames when recording stops
  useEffect(() => {
    if (!recording && animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
  }, [recording])

  // Make sure to clean up animation frames when component unmounts
  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      // Clear any active timers
      if (durationCounter !== null) {
        clearInterval(durationCounter)
      }
    }
  }, [durationCounter])

  return {
    startRecording,
    stopRecording,
    clearRecording,
    visualizerData,
    recording,
    durationSeconds,
    isDeviceFound,
    audioBlob,
  }
}
