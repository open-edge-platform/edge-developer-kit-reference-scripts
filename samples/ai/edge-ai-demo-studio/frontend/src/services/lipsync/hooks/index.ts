// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery } from '@tanstack/react-query'

const API_BASE = '/api/lipsync'

const ICE_SCHEME_RE = /^(stuns?|turns?):/i

/**
 * Build an RTCConfiguration from a user-provided ICE server URL.
 * - No URL → undefined (plain RTCPeerConnection)
 * - URL without scheme → auto-prefixed with `defaultScheme` ("stun" or "turn")
 * - TURN/TURNS URLs get dummy credentials attached
 */
export function buildIceConfig(
  url: string | undefined,
  defaultScheme: 'stun' | 'turn',
): RTCConfiguration | undefined {
  if (!url) return undefined
  const iceUrl = ICE_SCHEME_RE.test(url) ? url : `${defaultScheme}:${url}`
  const iceServer: RTCIceServer = {
    urls: iceUrl,
    username: 'dummy',
    credential: 'dummy',
  }
  return { iceServers: [iceServer] }
}

interface OfferResponse {
  sdp: string
  type: RTCSdpType
  session_id: string
}

interface AvatarSkin {
  skin_id: string
  skin_name?: string
}

export function useLipsyncOffer() {
  return useMutation({
    mutationFn: async (params: {
      sdp: string | undefined
      type: RTCSdpType
    }): Promise<OfferResponse> => {
      const res = await fetch(`${API_BASE}/v1/lipsync/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  })
}

export function useLipsyncChat() {
  return useMutation({
    mutationFn: async (params: {
      session_id: string
      chat_type: string
      text: string
      voice?: string
      speed?: string
      tts_url?: string
    }) => {
      const res = await fetch(`${API_BASE}/v1/lipsync/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  })
}

export function useAudioLipsync() {
  return useMutation({
    mutationFn: async (params: {
      audioFile: File
      sessionId: string
      textOverlay?: string
      languageCode?: string
    }) => {
      const formData = new FormData()
      formData.append('file', params.audioFile)
      formData.append('session_id', params.sessionId)
      if (params.textOverlay) {
        formData.append('text_overlay', params.textOverlay)
      }
      if (params.languageCode) {
        formData.append('language_code', params.languageCode)
      }

      const res = await fetch(`${API_BASE}/v1/lipsync`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  })
}

export function useSkinUpload() {
  return useMutation({
    mutationFn: async (params: {
      videoFile: File
      sessionId: string
      skinName?: string
    }) => {
      const formData = new FormData()
      formData.append('video', params.videoFile)
      formData.append('session_id', params.sessionId)
      if (params.skinName) {
        formData.append('skin_name', params.skinName)
      }

      const res = await fetch(`${API_BASE}/v1/avatar`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  })
}

export function useAvatarList(enabled: boolean) {
  return useQuery<AvatarSkin[]>({
    queryKey: ['lipsync', 'avatars'],
    enabled,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/avatar`)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      return data.items ?? []
    },
  })
}
