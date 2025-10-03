// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { FetchAPI } from '@/lib/api'
import { useMutation } from '@tanstack/react-query'

const LIPSYNC_API = new FetchAPI(`/api/lipsync`)

export const useGetRTCOffer = () => {
  return useMutation({
    mutationFn: async ({
      offer,
      turn,
    }: {
      offer: RTCSessionDescription
      turn: boolean
    }) => {
      const result = await LIPSYNC_API.post('offer', {
        sdp: offer?.sdp,
        type: offer?.type,
        turn,
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
      const result = await LIPSYNC_API.post('chat', {
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
      const result = await LIPSYNC_API.post('chat', {
        chat_type: 'stop',
        session_id: sessionId,
        language_code: '',
        text: '',
      })

      return result
    },
  })
}
