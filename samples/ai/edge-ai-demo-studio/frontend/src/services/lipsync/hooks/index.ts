// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requireApiBase } from '@/lib/browser/api-base'
import { fetchJson, postJson } from '@/lib/browser/fetch-json'
import { type CANCELLED, followStatusEvents } from '@/lib/browser/sse'
import { type JobDefinition, jobFailure } from '@/services/common/jobs/job-run'

const ICE_SCHEME_RE = /^(stuns?|turns?):/i

/** A URL without a scheme gets `defaultScheme`; the dummy credentials satisfy TURN servers. */
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

const ICE_GATHERING_TIMEOUT_MS = 5000

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

/** The skins listed by an instance (`GET /v1/avatar`). */
export const avatarsKey = (apiBase: string | undefined) =>
  ['lipsync', 'avatars', apiBase] as const

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
  status: 'processing' | 'finished' | 'error' | typeof CANCELLED | 'not_found'
  avatar_id?: string
  skin_name?: string
  /** What the job is doing: `queued`, `extracting`, `detecting`, `saving`, `musetalk`, `done`. */
  stage?: string
  /** The whole job's progress, 0–1. */
  progress?: number
  /** The current stage, for display. */
  message?: string
  detail?: string
  /** Set once cancelled; the job stays `processing` until it stops at its next frame. */
  cancel_requested?: boolean
}

/** A step of `POST /v1/lipsync/prepare`. */
export interface AvatarPrepareStatus {
  status: 'preparing' | 'ready' | 'error'
  /** MuseTalk's step while `preparing`: the face crops, then their latents. */
  stage?: 'crops' | 'latents'
  /** Avatar frames done, and of how many, while `preparing`. */
  done?: number
  total?: number
  detail?: string
}

/**
 * MuseTalk makes an avatar's face crops and latents on first use (minutes each on CPU, longer than
 * the offer may wait), so connecting prepares them first. Wav2Lip answers ready at once.
 */
export async function prepareAvatar(
  apiBase: string | undefined,
  {
    signal,
    onStatus,
  }: { signal?: AbortSignal; onStatus?: (status: AvatarPrepareStatus) => void },
): Promise<void> {
  requireApiBase(apiBase, 'Lipsync')
  const status = await followStatusEvents<AvatarPrepareStatus>(
    `${apiBase}/v1/lipsync/prepare`,
    {
      signal,
      onStatus,
      isFinal: (s) => s.status !== 'preparing',
      init: { method: 'POST' },
    },
  )
  if (status.status === 'error') {
    throw new Error(
      `The avatar could not be prepared: ${status.detail ?? 'unknown error'}`,
    )
  }
}

export function useLipsyncOffer(apiBase: string | undefined) {
  return useMutation({
    mutationFn: (params: {
      sdp: string | undefined
      type: RTCSdpType
    }): Promise<OfferResponse> => {
      requireApiBase(apiBase, 'Lipsync')
      return postJson(`${apiBase}/v1/lipsync/offer`, params)
    },
  })
}

interface ChatResponse {
  /** `success`, or why the worker did nothing (`invalid session id`). */
  status?: string
  frame_generation?: boolean
}

/** The worker answers a chat it will not act on with 200 and a status. */
function chatRejection(status: string | undefined): Error {
  return new Error(
    status === 'invalid session id'
      ? 'The avatar session is no longer valid. Reconnect and try again.'
      : `The avatar refused the message: ${status ?? 'unknown status'}`,
  )
}

export function useLipsyncChat(apiBase: string | undefined) {
  return useMutation({
    mutationFn: async (params: {
      session_id: string
      chat_type: string
      text: string
      voice?: string
      speed?: string
      tts_url?: string
      frame_generation?: boolean
    }): Promise<ChatResponse> => {
      requireApiBase(apiBase, 'Lipsync')
      const result = await postJson<ChatResponse | undefined>(
        `${apiBase}/v1/lipsync/chat`,
        params,
      )
      if (result?.status !== 'success') throw chatRejection(result?.status)
      return result
    },
  })
}

/** Stops the avatar speaking: drops the text and audio still queued. */
export function useLipsyncStop(apiBase: string | undefined) {
  return useMutation({
    mutationFn: (sessionId: string) => {
      requireApiBase(apiBase, 'Lipsync')
      return postJson(`${apiBase}/v1/lipsync/stop`, {
        session_id: sessionId,
        chat_type: 'stop',
      })
    },
  })
}

export function useAudioLipsync(apiBase: string | undefined) {
  return useMutation({
    mutationFn: (params: {
      audioFile: File
      sessionId: string
      textOverlay?: string
      languageCode?: string
      frameGeneration?: boolean
    }) => {
      requireApiBase(apiBase, 'Lipsync')
      const formData = new FormData()
      formData.append('file', params.audioFile)
      formData.append('session_id', params.sessionId)
      if (params.textOverlay) {
        formData.append('text_overlay', params.textOverlay)
      }
      if (params.languageCode) {
        formData.append('language_code', params.languageCode)
      }
      if (params.frameGeneration) {
        formData.append('frame_generation', 'true')
      }

      return fetchJson(`${apiBase}/v1/lipsync`, {
        method: 'POST',
        body: formData,
      })
    },
  })
}

/** A video to make an avatar skin from. */
export interface AvatarUpload {
  videoFile: File
  /** The live session to show the new skin on once it is made. */
  sessionId?: string
  skinName?: string
}

/**
 * Worker background job from `POST /v1/avatar`. `DELETE /v1/tasks/{taskId}` stops it at its next
 * frame and removes the half-made skin.
 */
export function avatarJob(
  apiBase: string | undefined,
): JobDefinition<AvatarUpload, AvatarTaskStatus, AvatarTaskStatus> {
  return {
    submit: async ({ videoFile, sessionId, skinName }, signal) => {
      requireApiBase(apiBase, 'Lipsync')
      const formData = new FormData()
      formData.append('video', videoFile)
      if (sessionId) formData.append('session_id', sessionId)
      if (skinName) formData.append('skin_name', skinName)
      const { taskId } = await fetchJson<{ taskId?: string }>(
        `${apiBase}/v1/avatar`,
        { method: 'POST', body: formData, signal },
      )
      if (!taskId) throw new Error('The worker did not start an avatar job')
      return taskId
    },
    jobUrl: (taskId) => `${apiBase}/v1/tasks/${encodeURIComponent(taskId)}`,
    // The job reports `processing` from the start; its stage says it waits.
    isQueued: (status) => status.stage === 'queued',
    toResult: (status) => {
      if (status.status !== 'finished') {
        throw jobFailure(
          status,
          status.status === 'not_found' ? 'the job was not found' : '',
        )
      }
      return status
    },
    followErrorMessage: 'Unable to check avatar generation status',
  }
}

export function useAvatarList(apiBase: string | undefined) {
  return useQuery<AvatarListResponse>({
    queryKey: avatarsKey(apiBase),
    enabled: Boolean(apiBase),
    queryFn: async () => {
      const data = await fetchJson<Partial<AvatarListResponse>>(
        `${apiBase}/v1/avatar`,
      )
      return {
        items: data.items ?? [],
        default_skin: data.default_skin ?? null,
      }
    },
  })
}

export function useDeleteSkin(apiBase: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (skinId: string) => {
      requireApiBase(apiBase, 'Lipsync')
      return fetchJson<void>(
        `${apiBase}/v1/avatar/${encodeURIComponent(skinId)}`,
        { method: 'DELETE' },
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: avatarsKey(apiBase) })
    },
  })
}

export interface SetDefaultSkinResponse {
  reloaded_sessions?: string[]
}

export function useSetDefaultSkin(apiBase: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (avatarId: string): Promise<SetDefaultSkinResponse> => {
      requireApiBase(apiBase, 'Lipsync')
      return postJson(
        `${apiBase}/v1/avatar/default`,
        { avatarId },
        { method: 'PATCH' },
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: avatarsKey(apiBase) })
    },
  })
}
