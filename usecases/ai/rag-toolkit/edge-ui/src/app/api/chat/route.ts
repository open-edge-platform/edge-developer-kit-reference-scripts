// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type NextRequest } from 'next/server';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { convertToModelMessages, streamText, UIMessage } from 'ai';

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- disable for route handler
export async function POST(req: NextRequest) {
  const {
    id,
    messages,
    modelID,
    max_tokens: maxTokens,
    temperature,
    conversationCount,
    rag,
    systemPrompt,
  }: {
    id: string;
    messages: UIMessage[];
    modelID: string;
    max_tokens: number;
    temperature: number;
    conversationCount: number;
    rag: boolean;
    systemPrompt: string;
  } = await req.json();

  const url = `http://${process.env.NEXT_PUBLIC_LLM_API_URL ?? 'localhost'}:${process.env.NEXT_PUBLIC_LLM_API_PORT ?? '8011'}`;
  const apiVersion = process.env.NEXT_PUBLIC_API_VERSION ?? 'v1';
  const baseURL = new URL(`${apiVersion}/`, url).toString();
  const provider = createOpenAICompatible({
    name: 'openai',
    apiKey: '-',
    baseURL: baseURL,
  });

  let conversationMessages = messages;

  if (conversationCount >= 0 && conversationCount * 2 < messages.length) {
    conversationMessages = conversationMessages.slice(-(conversationCount * 2 + 1));
  }

  try {
    const result = streamText({
      model: provider(modelID),
      system: systemPrompt,
      messages: await convertToModelMessages(conversationMessages),
      maxOutputTokens: maxTokens,
      temperature,
      headers: {
        rag: rag ? 'ON' : 'OFF',
      },
    });
    return result.toUIMessageStreamResponse();
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Failed to process chat request',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
