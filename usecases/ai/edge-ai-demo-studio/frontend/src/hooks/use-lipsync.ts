// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { FetchAPI } from '@/lib/api'
import { useMutation } from '@tanstack/react-query'

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
