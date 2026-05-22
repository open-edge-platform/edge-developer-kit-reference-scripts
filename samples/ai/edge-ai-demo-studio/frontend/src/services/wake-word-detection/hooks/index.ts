// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

const API_BASE = '/api/wake-word-detection'

export interface Subscriber {
  id: number
  url: string
  name: string
  threshold: number
}

export interface AudioDevice {
  id: number
  name: string
  is_default: boolean
}

export interface WakeWordModel {
  filename: string
  path: string
}

export interface HealthStatus {
  status: string
  model_loaded: boolean
  models: string[]
  detection_active: boolean
  subscribers: number
}

export function useWakeWordHealth(enabled: boolean) {
  return useQuery<HealthStatus>({
    queryKey: ['wake-word-detection', 'health'],
    enabled,
    refetchInterval: 10_000,
    queryFn: async () => {
      const url = new URL(`${API_BASE}/healthcheck`, window.location.origin)
      const res = await fetch(url)
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  })
}

export function useWakeWordSubscribers(enabled: boolean) {
  return useQuery<Subscriber[]>({
    queryKey: ['wake-word-detection', 'subscribers'],
    enabled,
    queryFn: async () => {
      const url = new URL(
        `${API_BASE}/v1/wake-word-detection/webhooks/subscribers`,
        window.location.origin,
      )
      const res = await fetch(url)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      return data.subscribers ?? []
    },
  })
}

export function useWakeWordDevices(enabled: boolean) {
  return useQuery<{ devices: AudioDevice[]; selectedDeviceId: number | null }>({
    queryKey: ['wake-word-detection', 'devices'],
    enabled,
    queryFn: async () => {
      const url = new URL(
        `${API_BASE}/v1/wake-word-detection/audio-devices`,
        window.location.origin,
      )
      const res = await fetch(url)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      return {
        devices: data.devices ?? [],
        selectedDeviceId: data.selected_device_id ?? null,
      }
    },
  })
}

export function useWakeWordModels(enabled: boolean) {
  return useQuery<{ models: WakeWordModel[]; loadedModels: string[] }>({
    queryKey: ['wake-word-detection', 'models'],
    enabled,
    queryFn: async () => {
      const url = new URL(
        `${API_BASE}/v1/wake-word-detection/models/list`,
        window.location.origin,
      )
      const res = await fetch(url)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      return {
        models: data.models ?? [],
        loadedModels: data.loaded_models ?? [],
      }
    },
  })
}

export function useSubscribeWebhook() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      url: string
      name?: string
      threshold: number
    }) => {
      const url = new URL(
        `${API_BASE}/v1/wake-word-detection/webhooks/subscribe`,
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
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['wake-word-detection', 'subscribers'],
      })
    },
  })
}

export function useUnsubscribeWebhook() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (url: string) => {
      const apiUrl = new URL(
        `${API_BASE}/v1/wake-word-detection/webhooks/unsubscribe`,
        window.location.origin,
      )
      apiUrl.searchParams.append('url', url)
      const res = await fetch(apiUrl, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['wake-word-detection', 'subscribers'],
      })
    },
  })
}

export function useToggleDetection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      start: boolean
      deviceId?: number | null
    }) => {
      const endpoint = params.start ? 'start' : 'stop'
      const body =
        params.start && params.deviceId != null
          ? JSON.stringify({ device_id: params.deviceId })
          : undefined
      const url = new URL(
        `${API_BASE}/v1/wake-word-detection/${endpoint}`,
        window.location.origin,
      )
      const res = await fetch(url, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body,
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['wake-word-detection', 'health'],
      })
    },
  })
}

export function useUploadModel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      const url = new URL(
        `${API_BASE}/v1/wake-word-detection/models/upload`,
        window.location.origin,
      )
      const res = await fetch(url, { method: 'POST', body: formData })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['wake-word-detection', 'models'],
      })
    },
  })
}

export function useDeleteModel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (filename: string) => {
      const url = new URL(
        `${API_BASE}/v1/wake-word-detection/models/delete/${encodeURIComponent(filename)}`,
        window.location.origin,
      )
      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['wake-word-detection', 'models'],
      })
    },
  })
}
