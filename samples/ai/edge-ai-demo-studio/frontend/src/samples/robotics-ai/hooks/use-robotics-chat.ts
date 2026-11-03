// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Chat, useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useState } from 'react'
import { useSampleInstancesBody } from '@/context/sample-instances-context'
import { useGetService } from '@/context/service-status-context'
import { agentLanguageName, type RobotLanguage } from '../lib/languages'

/** The sample's chat route: the agent sees the camera and drives the arm. */
const CHAT_API = '/api/services/robotics-ai/chat'

export const DEFAULT_CHAT_SUGGESTIONS = [
  'What can you see right now?',
  'Pickup all the items in the workspace',
  'Pickup the cube',
]

export interface SendOptions {
  /** Empty means "use all available tools". */
  toolId: string
  /** The mic's language; the agent answers in it. */
  language: RobotLanguage
  useMcp: boolean
}

/** The conversation with the robot agent, sent with the chosen tool and language. */
export function useRoboticsChat() {
  const [chat] = useState(
    () =>
      new Chat<UIMessage>({
        transport: new DefaultChatTransport({ api: CHAT_API }),
      }),
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
  const [input, setInput] = useState('')
  // The body of the last request, so Retry asks with the same settings.
  const [lastBody, setLastBody] = useState<object | undefined>(undefined)
  // The route resolves the worker from the instance key, never from an address the browser sends;
  // the sample's bindings make the chat run on the bound Text Generation instance.
  const roboticsInstanceKey = useGetService('robotics-ai')?.instanceKey
  const sampleInstances = useSampleInstancesBody()
  const isRunning = status === 'submitted' || status === 'streaming'

  return {
    messages,
    status,
    error,
    input,
    setInput,
    send: ({ toolId, language, useMcp }: SendOptions) => {
      const text = input.trim()
      if (!text || isRunning) return
      const body = {
        instanceKey: roboticsInstanceKey,
        toolId: toolId.trim() || undefined,
        language: agentLanguageName(language),
        useMcp,
        ...sampleInstances,
      }
      setLastBody(body)
      setInput('')
      sendMessage({ text }, { body })
    },
    retry: () => {
      if (isRunning || messages.length === 0) return
      regenerate(lastBody ? { body: lastBody } : undefined)
    },
    stop: () => void stop(),
    reset: () => {
      setMessages([])
      clearError()
      setInput('')
    },
  }
}

export type RoboticsChat = ReturnType<typeof useRoboticsChat>
