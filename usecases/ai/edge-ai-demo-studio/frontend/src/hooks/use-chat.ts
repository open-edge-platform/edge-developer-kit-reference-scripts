// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from '@tanstack/react-query'
import OpenAI from 'openai'

export const useChat = () => {
  return useMutation({
    mutationFn: async ({
      prompt,
      model,
    }: {
      prompt: string
      model: string
    }) => {
      const response = await fetch(`/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt, model }),
      })
      if (!response.ok) {
        throw new Error('Network response was not ok')
      }
      return response.json() as Promise<OpenAI.Chat.ChatCompletion>
    },
  })
}
