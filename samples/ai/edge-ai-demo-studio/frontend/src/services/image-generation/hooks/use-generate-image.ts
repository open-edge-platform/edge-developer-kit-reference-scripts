// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'

interface GenerateImageRequest {
  model: string
  prompt: string
  size?: string
  n?: number
  num_inference_steps?: number
  guidance_scale?: number
  negative_prompt?: string
  rng_seed?: number
}

interface ImageResponseData {
  b64_json?: string
  revised_prompt?: string
}

interface GenerateImageResponse {
  created: number
  data: ImageResponseData[]
}

export interface TaskStatus {
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  elapsed_time: number
  estimated_time: number | null
  result: GenerateImageResponse | string | null
}

const POLL_INTERVAL = 1500

async function startGenerateTask(request: GenerateImageRequest): Promise<void> {
  const response = await fetch('/api/image-generation/v3/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...request, is_polling: true }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(
      `Image generation failed (${response.status}): ${errorBody}`,
    )
  }
}

async function pollTaskStatus(): Promise<TaskStatus> {
  const response = await fetch(
    '/api/image-generation/v3/images/tasks/image-generation',
  )
  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(
      `Failed to get task status (${response.status}): ${errorBody}`,
    )
  }
  return response.json()
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(() => resolve(), ms)
  })
}

async function pollUntilDone(
  cancelledRef: { current: boolean },
  onStatus: (status: TaskStatus) => void,
): Promise<GenerateImageResponse> {
  while (!cancelledRef.current) {
    await wait(POLL_INTERVAL)
    if (cancelledRef.current) break

    const status = await pollTaskStatus()
    onStatus(status)

    if (status.status === 'completed' && status.result) {
      return status.result as GenerateImageResponse
    }
    if (status.status === 'failed') {
      throw new Error(
        typeof status.result === 'string'
          ? status.result
          : 'Image generation failed',
      )
    }
  }
  throw new Error('Generation cancelled')
}

export function useGenerateImage() {
  const [taskStatus, setTaskStatus] = useState<TaskStatus | null>(null)
  const cancelledRef = useRef(false)

  const stopPolling = useCallback(() => {
    cancelledRef.current = true
  }, [])

  const mutation = useMutation({
    mutationFn: async (
      request: GenerateImageRequest,
    ): Promise<GenerateImageResponse> => {
      setTaskStatus({
        status: 'pending',
        elapsed_time: 0,
        estimated_time: null,
        result: null,
      })
      cancelledRef.current = false

      await startGenerateTask(request)

      return pollUntilDone(cancelledRef, setTaskStatus)
    },
    onSettled: () => {
      stopPolling()
    },
  })

  const reset = useCallback(() => {
    stopPolling()
    setTaskStatus(null)
    mutation.reset()
  }, [stopPolling, mutation])

  return {
    ...mutation,
    taskStatus,
    reset,
  }
}
