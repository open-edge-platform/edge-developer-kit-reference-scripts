// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useMemo } from 'react'

export function useRoboticsChat() {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/services/robotics-ai/chat',
      }),
    [],
  )
  return useChat({ transport })
}
