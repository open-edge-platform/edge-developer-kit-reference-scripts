// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useCallback, useState } from 'react'
import type { TextGenParamValues } from './use-params'

interface UseTextGenChatOptions {
  textGenValues: TextGenParamValues
  /** Extra body fields merged into every sendMessage call */
  extraBody?: Record<string, unknown>
}

export function useTextGenChat({
  textGenValues,
  extraBody,
}: UseTextGenChatOptions) {
  const { messages, sendMessage, status, setMessages, stop } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/services/text-generation/chat',
    }),
  })
  const isRunning = status === 'submitted' || status === 'streaming'

  const [input, setInput] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)

  const handleImageSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      setImageFile(file)
      setImagePreview(URL.createObjectURL(file))
    },
    [],
  )

  const handleRemoveImage = useCallback(() => {
    setImageFile(null)
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImagePreview(null)
  }, [imagePreview])

  const handleSend = useCallback(() => {
    if (!input.trim() || isRunning) return
    let files: FileList | undefined
    if (imageFile) {
      const dt = new DataTransfer()
      dt.items.add(imageFile)
      files = dt.files
    }
    sendMessage(
      {
        text: input,
        ...(files ? { files } : {}),
      },
      {
        body: {
          maxTokens: textGenValues.maxTokens,
          temperature: textGenValues.temperature,
          topK: textGenValues.topK,
          ...(textGenValues.systemPrompt.trim()
            ? { systemPrompt: textGenValues.systemPrompt.trim() }
            : {}),
          disableReasoning: textGenValues.disableReasoning,
          ...extraBody,
        },
      },
    )
    setInput('')
    handleRemoveImage()
  }, [
    input,
    isRunning,
    imageFile,
    sendMessage,
    handleRemoveImage,
    textGenValues,
    extraBody,
  ])

  const handleReset = useCallback(() => {
    setMessages([])
    handleRemoveImage()
  }, [setMessages, handleRemoveImage])

  return {
    messages,
    status,
    isRunning,
    input,
    setInput,
    imageFile,
    imagePreview,
    handleImageSelect,
    handleRemoveImage,
    handleSend,
    handleReset,
    handleStop: stop,
  }
}
