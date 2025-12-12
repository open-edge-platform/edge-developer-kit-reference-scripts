// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { FetchAPI } from '@/lib/api'
import {
  ImageGenerationRequest,
  ImageEditRequest,
  ImageGenerationResponse,
} from '@/types/image-generation'
import { useMutation } from '@tanstack/react-query'
import { useState, useCallback, useEffect, useRef } from 'react'

const IMAGE_GENERATION_API = new FetchAPI(`/api/images`, 'v1')

export interface ProgressUpdate {
  progress: number
  message: string
  elapsed?: number
  estimatedTime?: number
}

export interface TaskStatus {
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  elapsed_time: number
  estimated_time?: number
  result?: ImageGenerationResponse | string
}

// Custom hook for polling task status
const useTaskPolling = (
  pollTaskStatus: () => Promise<TaskStatus>,
  isPolling: boolean,
  onComplete: (result: ImageGenerationResponse) => void,
  onError: (error: string) => void,
) => {
  const [taskStatus, setTaskStatus] = useState<TaskStatus | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (isPolling) {
      const poll = async () => {
        try {
          const status = await pollTaskStatus()
          setTaskStatus(status)

          if (status.status === 'completed' && status.result) {
            onComplete(status.result as ImageGenerationResponse)
          } else if (status.status === 'failed') {
            onError((status.result as string) || 'Task failed')
          }
        } catch (error) {
          console.error('Polling error:', error)
          onError('Failed to get task status')
        }
      }

      // Start polling immediately
      poll()

      // Then poll every 5 seconds
      intervalRef.current = setInterval(poll, 5000)
    } else {
      // Clear polling when not needed
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      setTaskStatus(null)
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [isPolling, pollTaskStatus, onComplete, onError])

  return taskStatus
}

export const useImageGeneration = () => {
  const [isPolling, setIsPolling] = useState(false)
  const [result, setResult] = useState<ImageGenerationResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const startTask = useMutation({
    mutationFn: async (params: ImageGenerationRequest) => {
      const requestParams = { ...params, is_polling: true }
      const response = await IMAGE_GENERATION_API.post(
        'generations',
        requestParams,
      )
      return response
    },
    onSuccess: () => {
      setIsPolling(true)
      setResult(null)
      setError(null)
    },
  })

  const pollTaskStatus = useCallback(async (): Promise<TaskStatus> => {
    const response = await IMAGE_GENERATION_API.get('tasks/image-generation')
    return response as TaskStatus
  }, [])

  const onComplete = useCallback((taskResult: ImageGenerationResponse) => {
    setResult(taskResult)
    setIsPolling(false)
  }, [])

  const onError = useCallback((errorMessage: string) => {
    setError(errorMessage)
    setIsPolling(false)
  }, [])

  const taskStatus = useTaskPolling(
    pollTaskStatus,
    isPolling,
    onComplete,
    onError,
  )

  const stopPolling = useCallback(() => {
    setIsPolling(false)
    setResult(null)
    setError(null)
  }, [])

  return {
    mutateAsync: startTask.mutateAsync,
    isPending: startTask.isPending || isPolling,
    isPolling,
    taskStatus,
    result,
    error,
    stopPolling,
  }
}

export const useImageEdit = () => {
  const [isPolling, setIsPolling] = useState(false)
  const [result, setResult] = useState<ImageGenerationResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const startTask = useMutation({
    mutationFn: async (params: ImageEditRequest) => {
      const formData = new FormData()

      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (key === 'image') {
            formData.append('image', value)
          } else {
            formData.append(key, value.toString())
          }
        }
      })

      // Add polling mode
      formData.append('is_polling', 'true')

      const response = await IMAGE_GENERATION_API.post('edits', formData, {
        headers: {},
      })

      return response
    },
    onSuccess: () => {
      setIsPolling(true)
      setResult(null)
      setError(null)
    },
  })

  const pollTaskStatus = useCallback(async (): Promise<TaskStatus> => {
    const response = await IMAGE_GENERATION_API.get('tasks/image-edit')
    return response as TaskStatus
  }, [])

  const onComplete = useCallback((taskResult: ImageGenerationResponse) => {
    setResult(taskResult)
    setIsPolling(false)
  }, [])

  const onError = useCallback((errorMessage: string) => {
    setError(errorMessage)
    setIsPolling(false)
  }, [])

  const taskStatus = useTaskPolling(
    pollTaskStatus,
    isPolling,
    onComplete,
    onError,
  )

  const stopPolling = useCallback(() => {
    setIsPolling(false)
    setResult(null)
    setError(null)
  }, [])

  return {
    mutateAsync: startTask.mutateAsync,
    isPending: startTask.isPending || isPolling,
    isPolling,
    taskStatus,
    result,
    error,
    stopPolling,
  }
}

export interface ImageGenerationFormData {
  prompt: string
  negativePrompt: string
  sizeMode: 'auto' | 'custom'
  customWidth: number
  customHeight: number
  numImages: number
  steps: number
  rngSeed: number
  guidanceScale: number
  showAdvanced: boolean
}

export interface ImageEditFormData extends Omit<
  ImageGenerationFormData,
  'numImages'
> {
  numImages: number
  sourceImage: File | null
  sourceImagePreview: string
}

const DEFAULT_FORM_DATA: ImageGenerationFormData = {
  prompt: '',
  negativePrompt: '',
  sizeMode: 'auto',
  customWidth: 512,
  customHeight: 512,
  numImages: 1,
  steps: 50,
  rngSeed: 409,
  guidanceScale: 7.5,
  showAdvanced: false,
}

export interface ImageGenerationForm {
  formData: ImageGenerationFormData
  updateField: (
    field: keyof ImageGenerationFormData,
    value: string | number | boolean | null,
  ) => void
  getFormattedSize: () => string
  reset: () => void
}

export function useImageGenerationForm() {
  const [formData, setFormData] =
    useState<ImageGenerationFormData>(DEFAULT_FORM_DATA)

  const updateField = (
    field: keyof ImageGenerationFormData,
    value: string | number | boolean | null,
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const getFormattedSize = () => {
    return formData.sizeMode === 'auto'
      ? 'auto'
      : `${formData.customWidth}x${formData.customHeight}`
  }

  const reset = () => setFormData(DEFAULT_FORM_DATA)

  return {
    formData,
    updateField,
    getFormattedSize,
    reset,
  }
}

export interface ImageEditForm {
  formData: ImageEditFormData
  updateField: (
    field: keyof ImageEditFormData,
    value: string | number | boolean | null,
  ) => void
  getFormattedSize: () => string
  handleFileUpload: (file: File) => Promise<string>
  reset: () => void
}

export function useImageEditForm() {
  const [formData, setFormData] = useState<ImageEditFormData>({
    ...DEFAULT_FORM_DATA,
    sourceImage: null,
    sourceImagePreview: '',
  })

  const updateField = (
    field: keyof ImageEditFormData,
    value: string | number | boolean | null,
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const getFormattedSize = () => {
    return formData.sizeMode === 'auto'
      ? 'auto'
      : `${formData.customWidth}x${formData.customHeight}`
  }

  const handleFileUpload = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) {
        reject(new Error('Please select a valid image file'))
        return
      }

      setFormData((prev) => ({ ...prev, sourceImage: file }))

      const reader = new FileReader()
      reader.onload = (e) => {
        const result = e.target?.result as string
        setFormData((prev) => ({ ...prev, sourceImagePreview: result }))
        resolve(result)
      }
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsDataURL(file)
    })
  }

  const reset = () =>
    setFormData({
      ...DEFAULT_FORM_DATA,
      sourceImage: null,
      sourceImagePreview: '',
    })

  return {
    formData,
    updateField,
    getFormattedSize,
    handleFileUpload,
    reset,
  }
}
