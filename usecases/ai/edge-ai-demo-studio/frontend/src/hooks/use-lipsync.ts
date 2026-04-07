// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { FetchAPI } from '@/lib/api'
import { LipsyncStatus, LipsyncStatusTracker } from '@/lib/lipsync-status'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

const LIPSYNC_API = new FetchAPI(`/api/lipsync`, 'v1')

export const useGetRTCOffer = () => {
  return useMutation({
    mutationFn: async ({
      offer,
      turn,
    }: {
      offer: RTCSessionDescription
      turn: boolean
    }) => {
      const result = await LIPSYNC_API.post('lipsync/offer', {
        sdp: offer?.sdp,
        type: offer?.type,
        turn,
      })

      return result
    },
  })
}

export const useSkinUpload = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      videoFile,
      sessionId,
      skinName,
    }: {
      videoFile: File
      sessionId: string
      skinName?: string
    }) => {
      const formData = new FormData()
      formData.append('video', videoFile)
      formData.append('session_id', sessionId)

      if (skinName) {
        formData.append('skin_name', skinName)
      }

      const result = await LIPSYNC_API.post('avatar', formData, {
        headers: {},
      })

      const taskId = result.taskId
      if (!taskId) throw new Error('No taskId returned from server')

      while (true) {
        const res = await fetch(`/api/lipsync/v1/tasks/${taskId}`)
        if (!res.ok) throw new Error(`Status check failed (${res.status})`)
        const data = await res.json()
        if (data.status === 'finished') {
          return { taskId, ...data }
        } else if (data.status === 'error') {
          throw new Error(data.detail || 'Task failed.')
        }

        await new Promise<void>((res) => {
          setTimeout(() => res(), 2000)
        })
      }
    },

    onSuccess: () => {
      // Refresh skin list after generation
      queryClient.invalidateQueries({
        queryKey: ['avatar-skins'],
      })
    },
  })
}

export const useSkinListQuery = () => {
  return useQuery({
    queryKey: ['avatar-skins'],
    queryFn: async (): Promise<unknown[]> => {
      const res = await LIPSYNC_API.get('avatar')
      const body: unknown =
        res && typeof res === 'object' && res !== null && 'data' in res
          ? (res as { data?: unknown }).data
          : res

      let data: unknown = body
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data)
        } catch {
          return []
        }
      }

      if (
        data &&
        typeof data === 'object' &&
        Array.isArray((data as { items?: unknown }).items)
      ) {
        return (data as { items: unknown[] }).items
      }
      return []
    },
  })
}

export const useSkinSelect = () => {
  return useMutation({
    mutationFn: async ({ avatarId }: { avatarId: string }) => {
      const result = await LIPSYNC_API.patch('avatar/default', {
        avatarId,
      })

      return result
    },
  })
}

export const useAudioLipsync = () => {
  return useMutation({
    mutationFn: async ({
      audioFile,
      sessionId,
      textOverlay,
      languageCode = 'en-US',
    }: {
      audioFile: File
      sessionId: string
      textOverlay?: string
      languageCode?: string
    }) => {
      const formData = new FormData()
      formData.append('file', audioFile)
      formData.append('session_id', sessionId)

      if (textOverlay) {
        formData.append('text_overlay', textOverlay)
      }
      formData.append('language_code', languageCode)

      const result = await LIPSYNC_API.post('lipsync', formData, {
        headers: {}, // Remove Content-Type to let browser set it for FormData
      })

      return result
    },
  })
}

export const useSendLipsyncMessage = () => {
  return useMutation({
    mutationFn: async ({
      text,
      sessionId,
      voice,
      model,
      speed,
    }: {
      text: string
      sessionId: string
      voice: string
      model: string
      speed: string
    }) => {
      const result = await LIPSYNC_API.post('lipsync/chat', {
        chat_type: 'echo',
        session_id: sessionId,
        voice,
        text,
        model,
        speed,
      })

      return result
    },
  })
}

export const useStopAvatar = () => {
  return useMutation({
    mutationFn: async ({ sessionId }: { sessionId: string }) => {
      const result = await LIPSYNC_API.post('lipsync/stop', {
        chat_type: 'stop',
        session_id: sessionId,
      })

      return result
    },
  })
}

export function useLipsyncStatus(sessionId: string | undefined) {
  const [status, setStatus] = useState<LipsyncStatus>('idle')
  const trackerRef = useRef<LipsyncStatusTracker | null>(null)

  useEffect(() => {
    if (!sessionId) return

    const tracker = new LipsyncStatusTracker(sessionId)
    tracker.connectWebSocket((newStatus) => {
      setStatus(newStatus)
    })

    trackerRef.current = tracker

    return () => {
      tracker.disconnect()
    }
  }, [sessionId])

  return {
    status,
    setStatus,
    isProcessing: status === 'processing',
  }
}
