// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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

export const ICE_GATHERING_TIMEOUT_MS = 5000

export function waitForIceGathering(
  pc: RTCPeerConnection,
  timeoutMs: number = ICE_GATHERING_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve(true)
      return
    }
    const finish = (completed: boolean) => {
      clearTimeout(timer)
      pc.removeEventListener('icegatheringstatechange', onStateChange)
      resolve(completed)
    }
    const onStateChange = () => {
      if (pc.iceGatheringState === 'complete') finish(true)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    pc.addEventListener('icegatheringstatechange', onStateChange)
  })
}

interface OfferResponse {
  sdp: string
  type: RTCSdpType
  session_id: string
}

export interface AvatarSkin {
  skin_id: string
  skin_name?: string
}

export interface AvatarListResponse {
  items: AvatarSkin[]
  default_skin: string | null
}

export interface AvatarTaskStatus {
  status: string
  avatar_id?: string
  skin_name?: string
  detail?: string
}

const TERMINAL_TASK_STATUSES = ['finished', 'error', 'not_found']

export function useLipsyncOffer() {
  return useMutation({
    mutationFn: async (params: {
      sdp: string | undefined
      type: RTCSdpType
    }): Promise<OfferResponse> => {
      const url = new URL(
        `${API_BASE}/v1/lipsync/offer`,
        window.location.origin,
      )
      const res = await fetch(url, {
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
      sessionId?: string
      skinName?: string
    }) => {
      const formData = new FormData()
      formData.append('video', params.videoFile)
      if (params.sessionId) {
        formData.append('session_id', params.sessionId)
      }
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

export function useAvatarTaskStatus(taskId: string | null) {
  return useQuery<AvatarTaskStatus>({
    queryKey: ['lipsync', 'task', taskId],
    enabled: taskId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && TERMINAL_TASK_STATUSES.includes(status) ? false : 2000
    },
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/tasks/${taskId}`)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      return typeof data === 'string' ? { status: data } : data
    },
  })
}

export function useAvatarList(enabled: boolean) {
  return useQuery<AvatarListResponse>({
    queryKey: ['lipsync', 'avatars'],
    enabled,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/avatar`)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      return {
        items: data.items ?? [],
        default_skin: data.default_skin ?? null,
      }
    },
  })
}

export function useDeleteSkin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (skinId: string) => {
      const url = new URL(
        `${API_BASE}/v1/avatar/${encodeURIComponent(skinId)}`,
        window.location.origin,
      )
      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lipsync', 'avatars'] })
    },
  })
}

export interface SetDefaultSkinResponse {
  reloaded_sessions?: string[]
}

export function useSetDefaultSkin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (avatarId: string): Promise<SetDefaultSkinResponse> => {
      const res = await fetch(`${API_BASE}/v1/avatar/default`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarId }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lipsync', 'avatars'] })
    },
  })
}
