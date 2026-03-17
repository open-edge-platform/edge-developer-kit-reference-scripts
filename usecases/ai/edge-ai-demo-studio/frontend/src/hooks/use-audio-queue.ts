'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { secureRandom } from '@/lib/utils'
import { logger } from '@/utils/logger'
import { TEXT_TO_SPEECH_URL } from '@/lib/workloads/text-to-speech'

interface AudioQueueItem {
  id: string
  src: string
  text?: string
  type?: string
  onStart?: () => void
  onEnd?: () => void
  onError?: (error: Error) => void
}

interface TTSOptions {
  model?: string
  voice?: string
  responseFormat?: string
  speed?: number
  onStart?: () => void
  onEnd?: () => void
  onError?: (error: Error) => void
}

interface UseAudioQueueReturn {
  addToQueue: (
    item: Omit<AudioQueueItem, 'id'> | string,
    index?: number,
  ) => void
  addTextToQueue: (
    text: string,
    index?: number,
    options?: TTSOptions,
    type?: string,
  ) => Promise<void>
  clearQueue: () => void
  isPlaying: boolean
  currentAudio: AudioQueueItem | null
  queueLength: number
  skip: () => void
  isGenerating: boolean
}

export function useAudioQueue(): UseAudioQueueReturn {
  const [queue, setQueue] = useState<AudioQueueItem[]>([])
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentAudio, setCurrentAudio] = useState<AudioQueueItem | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const isProcessingRef = useRef(false)
  const blobUrlsRef = useRef<Set<string>>(new Set())

  // Play the next audio in the queue
  const playNext = useCallback(() => {
    if (isProcessingRef.current || queue.length === 0) {
      return
    }

    isProcessingRef.current = true
    const nextAudio = queue[0]
    setCurrentAudio(nextAudio)
    setIsPlaying(true)

    // Create new audio element
    const audio = new Audio(nextAudio.src)
    audioRef.current = audio

    // Call onStart callback if provided
    if (nextAudio.onStart) {
      nextAudio.onStart()
    }

    // Handle audio end event
    const handleEnded = () => {
      setIsPlaying(false)
      setCurrentAudio(null)

      // Call onEnd callback if provided
      if (nextAudio.onEnd) {
        nextAudio.onEnd()
      }

      // Remove the played audio from queue
      setQueue((prevQueue) => prevQueue.slice(1))
      isProcessingRef.current = false

      // Clean up audio element
      if (audioRef.current) {
        audioRef.current.removeEventListener('ended', handleEnded)
        audioRef.current.removeEventListener('error', handleError)
        audioRef.current = null
      }
    }

    // Handle audio error event
    const handleError = (event: Event | string) => {
      const error = new Error(
        typeof event === 'string'
          ? event
          : `Failed to load audio: ${nextAudio.src}`,
      )

      logger.error('Audio playback error:', error)

      if (nextAudio.onError) {
        nextAudio.onError(error)
      }

      setIsPlaying(false)
      setCurrentAudio(null)

      // Remove the failed audio from queue
      setQueue((prevQueue) => prevQueue.slice(1))
      isProcessingRef.current = false

      // Clean up audio element
      if (audioRef.current) {
        audioRef.current.removeEventListener('ended', handleEnded)
        audioRef.current.removeEventListener('error', handleError)
        audioRef.current = null
      }
    }

    // Attach event listeners
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', handleError)

    // Start playback
    audio.play().catch((err) => {
      handleError(`Playback failed: ${err.message}`)
    })
  }, [queue])

  // Auto-play when queue changes and nothing is currently playing
  useEffect(() => {
    if (!isPlaying && queue.length > 0 && !isProcessingRef.current) {
      playNext()
    }
  }, [queue, isPlaying, playNext])

  // Add audio to queue
  const addToQueue = useCallback(
    (item: Omit<AudioQueueItem, 'id'> | string, index?: number) => {
      const audioItem: AudioQueueItem =
        typeof item === 'string'
          ? {
              id: `audio-${Date.now()}-${secureRandom()}`,
              src: item,
            }
          : {
              id: `audio-${Date.now()}-${secureRandom()}`,
              ...item,
            }

      setQueue((prevQueue) => {
        // If no index specified, add to end of queue
        if (index === undefined) {
          return [...prevQueue, audioItem]
        }

        // Convert 1-based index to 0-based and clamp to valid range
        const insertIndex = Math.max(
          0,
          Math.min(
            index - 1, // external callers use 1-based index; queue array is 0-based
            prevQueue.length,
          ),
        )

        // Insert at the specified position
        const newQueue = [...prevQueue]
        newQueue.splice(insertIndex, 0, audioItem)
        return newQueue
      })
    },
    [],
  )

  // Clear the entire queue and stop current playback
  const clearQueue = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      audioRef.current = null
    }

    setQueue([])
    setIsPlaying(false)
    setCurrentAudio(null)
    isProcessingRef.current = false
  }, [])

  // Skip current audio and play next
  const skip = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0

      // Manually trigger the ended event to clean up and move to next
      const endedEvent = new Event('ended')
      audioRef.current.dispatchEvent(endedEvent)
    }
  }, [])

  // Add text to queue by converting to speech first
  const addTextToQueue = useCallback(
    async (
      text: string,
      index?: number,
      options?: TTSOptions,
      type?: string,
    ) => {
      if (!text.trim()) {
        throw new Error('Text cannot be empty')
      }

      setIsGenerating(true)

      try {
        const response = await fetch(`${TEXT_TO_SPEECH_URL}/v1/audio/speech`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            input: text,
            model: options?.model || 'kokoro',
            voice: options?.voice || 'af_sky',
            responseFormat: options?.responseFormat || 'wav',
            speed: options?.speed || 1.0,
            stream: false,
          }),
        })

        if (!response.ok) {
          throw new Error('Failed to generate speech from text')
        }

        const blob = await response.blob()
        const url = URL.createObjectURL(blob)

        // Keep track of blob URLs for cleanup
        blobUrlsRef.current.add(url)

        // Add the generated audio to queue at the specified index
        addToQueue(
          {
            src: url,
            type,
            text,
            onStart: options?.onStart,
            onEnd: () => {
              // Clean up blob URL after playback
              URL.revokeObjectURL(url)
              blobUrlsRef.current.delete(url)
              options?.onEnd?.()
            },
            onError: (error) => {
              // Clean up blob URL on error
              URL.revokeObjectURL(url)
              blobUrlsRef.current.delete(url)
              options?.onError?.(error)
            },
          },
          index, // Use the index parameter (1-based)
        )
      } catch (error) {
        const err =
          error instanceof Error ? error : new Error('Unknown error occurred')
        options?.onError?.(err)
        throw err
      } finally {
        setIsGenerating(false)
      }
    },
    [addToQueue],
  )

  // Cleanup on unmount
  useEffect(() => {
    const blobUrls = blobUrlsRef.current
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      // Clean up all blob URLs
      blobUrls.forEach((url) => URL.revokeObjectURL(url))
      blobUrls.clear()
    }
  }, [])

  return {
    addToQueue,
    addTextToQueue,
    clearQueue,
    isPlaying,
    currentAudio,
    queueLength: queue.length,
    skip,
    isGenerating,
  }
}
