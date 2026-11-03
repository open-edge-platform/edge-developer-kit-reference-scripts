// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useChat } from '@ai-sdk/react'
import { useSampleInstancesBody } from '@/context/sample-instances-context'
import { demoStateKey } from '@/services/common/demo/demo-session'
import {
  useSessionResource,
  useSessionState,
  useSetSessionBusy,
} from '@/services/common/demo/session-store'
import type { ChatAttachments } from '../lib/chat-helpers'
import { chatRequestBody } from '../lib/chat-request'
import { createChat, PreviewUrls } from '../lib/chat-session'
import type { RequestParams, TextGenParamValues } from './use-params'

interface AttachedImage {
  file: File
  previewUrl: string
}

export interface ChatSendOptions {
  /** Extra files for this message only (e.g. a camera frame); they don't join the draft. */
  files?: File[]
}

interface UseTextGenChatOptions {
  textGenValues: TextGenParamValues
  requestParams: RequestParams
  /** Merged into every request body. */
  extraBody?: Record<string, unknown>
  /**
   * Instance key: under a `DemoSessionProvider` the conversation, draft and an in-flight response
   * survive remounts per key, and the instance is marked busy while generating.
   */
  sessionKey?: string
}

/**
 * A conversation with the chat route: draft with images, Send, Retry with the failed request's
 * settings, Stop and Clear. Stopped when released with the demo session (or on unmount).
 */
export function useTextGenChat({
  textGenValues,
  requestParams,
  extraBody,
  sessionKey,
}: UseTextGenChatOptions) {
  const stateKey = (name: string) =>
    sessionKey
      ? demoStateKey({ id: 'text-generation', instanceKey: sessionKey }, name)
      : undefined
  const setSessionBusy = useSetSessionBusy()
  const setBusy = (busy: boolean) => {
    if (sessionKey) setSessionBusy(sessionKey, busy)
  }

  const chat = useSessionResource(
    stateKey('chat'),
    () =>
      createChat(sessionKey, () => {
        if (sessionKey) setSessionBusy(sessionKey, false)
      }),
    (released) => void released.stop(),
  )
  const {
    messages,
    sendMessage,
    regenerate,
    status,
    error,
    setMessages,
    clearError,
    stop,
  } = useChat({ chat })
  const isRunning = status === 'submitted' || status === 'streaming'
  // On a sample page, the route must reach the same instances the sample binds.
  const sampleInstances = useSampleInstancesBody()

  const [input, setInput] = useSessionState(stateKey('input'), '')
  const [images, setImages] = useSessionState<AttachedImage[]>(
    stateKey('images'),
    [],
  )
  // So Retry uses the same instance and settings even if they changed since.
  const [lastBody, setLastBody] = useSessionState<object | undefined>(
    stateKey('request'),
    undefined,
  )

  // Owned by the session, not the component, so a kept draft still shows its previews on remount.
  const previewUrls = useSessionResource(
    stateKey('previews'),
    () => new PreviewUrls(),
    (urls) => urls.revokeAll(),
  )

  const attach = (files: File[]) => {
    if (files.length === 0) return
    const added = files.map((file) => ({
      file,
      previewUrl: previewUrls.create(file),
    }))
    setImages((prev) => [...prev, ...added])
  }

  const remove = (index: number) => {
    const removed = images[index]
    if (removed) previewUrls.revoke(removed.previewUrl)
    setImages(images.filter((_, i) => i !== index))
  }

  const clearImages = () => {
    images.forEach((img) => previewUrls.revoke(img.previewUrl))
    setImages([])
  }

  const requestBody = () => ({
    ...chatRequestBody(textGenValues, requestParams),
    ...sampleInstances,
    ...extraBody,
  })

  /** Returns false without text or while a response is still generating. */
  const handleSend = (options?: ChatSendOptions): boolean => {
    if (!input.trim() || isRunning) return false
    const files = [...images.map((img) => img.file), ...(options?.files ?? [])]
    let fileList: FileList | undefined
    if (files.length > 0) {
      const dt = new DataTransfer()
      files.forEach((file) => dt.items.add(file))
      fileList = dt.files
    }
    const body = requestBody()
    setLastBody(body)
    setBusy(true)
    // `finally` also covers a send stopped while its images were still read (no request starts).
    sendMessage(
      {
        text: input,
        ...(fileList ? { files: fileList } : {}),
      },
      { body },
    ).finally(() => setBusy(false))
    setInput('')
    // The message holds its own copy of the files, so the previews can go.
    clearImages()
    return true
  }

  const handleRetry = () => {
    if (isRunning || messages.length === 0) return
    setBusy(true)
    regenerate({ body: lastBody ?? requestBody() }).finally(() =>
      setBusy(false),
    )
  }

  const handleReset = () => {
    setMessages([])
    clearError()
    clearImages()
  }

  const attachments: ChatAttachments = {
    previews: images.map((img) => img.previewUrl),
    attach,
    remove,
  }

  return {
    messages,
    status,
    error,
    isRunning,
    input,
    setInput,
    attachments,
    handleSend,
    handleRetry,
    handleReset,
    handleStop: stop,
  }
}
