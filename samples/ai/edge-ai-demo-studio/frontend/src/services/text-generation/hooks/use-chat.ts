// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TextGenParamValues } from './use-params'

interface AttachedImage {
  file: File
  previewUrl: string
}

interface UseTextGenChatOptions {
  textGenValues: TextGenParamValues
  /** Numeric sampling params the user has changed; untouched ones are omitted. */
  requestParams: Partial<
    Pick<
      TextGenParamValues,
      'maxTokens' | 'temperature' | 'topP' | 'topK' | 'repetitionPenalty'
    >
  >
  /** Extra body fields merged into every sendMessage call */
  extraBody?: Record<string, unknown>
}

export function useTextGenChat({
  textGenValues,
  requestParams,
  extraBody,
}: UseTextGenChatOptions) {
  const { messages, sendMessage, status, setMessages, stop } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/services/text-generation/chat',
    }),
  })
  const isRunning = status === 'submitted' || status === 'streaming'

  const [input, setInput] = useState('')
  const [images, setImages] = useState<AttachedImage[]>([])

  const handleImageSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      if (files.length === 0) return
      setImages((prev) => [
        ...prev,
        ...files.map((file) => ({
          file,
          previewUrl: URL.createObjectURL(file),
        })),
      ])
    },
    [],
  )

  const handleRemoveImage = useCallback((index: number) => {
    setImages((prev) => {
      const removed = prev[index]
      if (removed) URL.revokeObjectURL(removed.previewUrl)
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  const handleClearImages = useCallback(() => {
    setImages((prev) => {
      prev.forEach((img) => URL.revokeObjectURL(img.previewUrl))
      return []
    })
  }, [])

  const imagesRef = useRef(images)
  useEffect(() => {
    imagesRef.current = images
  }, [images])
  useEffect(() => {
    return () => {
      imagesRef.current.forEach((img) => URL.revokeObjectURL(img.previewUrl))
    }
  }, [])

  const handleSend = useCallback(() => {
    if (!input.trim() || isRunning) return
    let files: FileList | undefined
    if (images.length > 0) {
      const dt = new DataTransfer()
      images.forEach((img) => dt.items.add(img.file))
      files = dt.files
    }
    sendMessage(
      {
        text: input,
        ...(files ? { files } : {}),
      },
      {
        body: {
          ...requestParams,
          ...(textGenValues.systemPrompt.trim()
            ? { systemPrompt: textGenValues.systemPrompt.trim() }
            : {}),
          disableReasoning: textGenValues.disableReasoning,
          reasoningParser: textGenValues.reasoningParser,
          ...extraBody,
        },
      },
    )
    setInput('')
    handleClearImages()
  }, [
    input,
    isRunning,
    images,
    sendMessage,
    handleClearImages,
    textGenValues,
    requestParams,
    extraBody,
  ])

  const handleReset = useCallback(() => {
    setMessages([])
    handleClearImages()
  }, [setMessages, handleClearImages])

  return {
    messages,
    status,
    isRunning,
    input,
    setInput,
    imagePreviews: images.map((img) => img.previewUrl),
    handleImageSelect,
    handleRemoveImage,
    handleClearImages,
    handleSend,
    handleReset,
    handleStop: stop,
  }
}
