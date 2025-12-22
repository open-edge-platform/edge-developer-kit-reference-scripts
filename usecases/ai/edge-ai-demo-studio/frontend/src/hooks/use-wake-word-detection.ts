// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { FetchAPI } from '@/lib/api'
import { useMutation, useQuery } from '@tanstack/react-query'

const WWD_API = new FetchAPI(`/api/wake-word-detection`)

export const useGetDetectionStatus = ({ enabled }: { enabled: boolean }) => {
  return useQuery({
    queryKey: ['wake-word-detection-status'],
    queryFn: async () => {
      const response = await WWD_API.get('healthcheck')
      return response
    },
    enabled,
    refetchInterval: 2000, // Poll every 2 seconds
  })
}

export const useUploadWakeWordModel = () => {
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)

      const response = await WWD_API.post(
        'v1/wake-word-detection/models/upload',
        formData,
        {
          headers: {},
        },
      )

      if (!response.status) {
        throw new Error(response.message || 'Failed to upload model')
      }

      return response
    },
  })
}

export const useReloadWakeWordModels = () => {
  return useMutation({
    mutationFn: async ({
      modelFilenames,
      vadThreshold,
    }: {
      modelFilenames: string[]
      vadThreshold: number
    }) => {
      const response = await WWD_API.post(
        'v1/wake-word-detection/models/reload',
        {
          model_filenames: modelFilenames,
          vad_threshold: vadThreshold,
        },
      )
      return response
    },
  })
}

export const useListWakeWordModels = ({ enabled }: { enabled: boolean }) => {
  return useQuery({
    queryKey: ['wake-word-models'],
    queryFn: async () => {
      const response = await WWD_API.get('v1/wake-word-detection/models/list')
      return response
    },
    enabled,
  })
}

export const useListAudioDevices = ({ enabled }: { enabled: boolean }) => {
  return useQuery({
    queryKey: ['wake-word-audio-devices'],
    queryFn: async () => {
      const response = await WWD_API.get('v1/wake-word-detection/audio-devices')
      return response
    },
    enabled,
  })
}

export const useDeleteWakeWordModel = () => {
  return useMutation({
    mutationFn: async (filename: string) => {
      const response = await WWD_API.delete(
        `v1/wake-word-detection/models/delete/${filename}`,
      )
      return response
    },
  })
}

export const useStartDetection = () => {
  return useMutation({
    mutationFn: async (deviceId: number) => {
      const response = await WWD_API.post('v1/wake-word-detection/start', {
        device_id: deviceId,
      })
      return response
    },
  })
}

export const useStopDetection = () => {
  return useMutation({
    mutationFn: async () => {
      const response = await WWD_API.post('v1/wake-word-detection/stop', {})
      return response
    },
  })
}

export const useSubscribeWebhook = () => {
  return useMutation({
    mutationFn: async ({
      url,
      name,
      threshold,
      apiKey,
    }: {
      url: string
      name?: string
      threshold?: number
      apiKey?: string
    }) => {
      const response = await WWD_API.post(
        'v1/wake-word-detection/webhooks/subscribe',
        {
          url,
          name,
          threshold,
          api_key: apiKey,
        },
      )
      return response
    },
  })
}

export const useUpdateWebhookSubscriber = () => {
  return useMutation({
    mutationFn: async ({
      url,
      name,
      threshold,
      apiKey,
    }: {
      url: string
      name?: string
      threshold?: number
      apiKey?: string
    }) => {
      const response = await WWD_API.patch(
        'v1/wake-word-detection/webhooks/subscriber',
        {
          url,
          name,
          threshold,
          api_key: apiKey,
        },
      )
      return response
    },
  })
}

export const useUnsubscribeWebhook = () => {
  return useMutation({
    mutationFn: async (url: string) => {
      const response = await WWD_API.delete(
        `v1/wake-word-detection/webhooks/unsubscribe?url=${url}`,
      )
      return response
    },
  })
}

export const useGetWebhookSubscribers = ({ enabled }: { enabled: boolean }) => {
  return useQuery({
    queryKey: ['wake-word-subscribers'],
    queryFn: async () => {
      const response = await WWD_API.get(
        'v1/wake-word-detection/webhooks/subscribers',
      )
      return response
    },
    enabled,
  })
}

export const useTestWebhook = () => {
  return useMutation({
    mutationFn: async () => {
      const response = await WWD_API.post(
        'v1/wake-word-detection/webhooks/test-webhook',
        {},
      )
      return response
    },
  })
}
