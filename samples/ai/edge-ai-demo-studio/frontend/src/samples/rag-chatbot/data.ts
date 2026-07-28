// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Sample } from '../types'
import { RagChatbotDemo } from './demo'
import sampleImage from './image.png'

export const sample: Sample = {
  id: 'rag-chatbot',
  title: 'RAG Chatbot',
  description:
    'Upload documents and chat with an AI that retrieves relevant context to answer your questions.',
  longDescription:
    'A retrieval-augmented generation chatbot that ingests documents, embeds them into a vector store for semantic search, and uses an LLM to generate grounded answers with source citations. Optionally supports voice input via STT and voice output via TTS for hands-free interaction.',
  category: ['Conversational AI'],
  dependencies: [
    {
      serviceId: 'text-generation',
      role: 'required',
      recommended: {
        device: 'GPU.1',
      },
    },
    { serviceId: 'embeddings', role: 'required' },
    { serviceId: 'vectordb', role: 'required' },
    {
      serviceId: 'rerank',
      role: 'optional',
      capabilityKey: 'reranking',
      impactText: 'Search results will not be reranked for relevance.',
    },
    {
      serviceId: 'speech-to-text',
      role: 'optional',
      capabilityKey: 'voice_input',
      impactText: 'Voice input will be disabled.',
    },
    {
      serviceId: 'text-to-speech',
      role: 'optional',
      capabilityKey: 'voice_output',
      impactText: 'Voice readback of answers will be disabled.',
    },
    {
      serviceId: 'mcp',
      role: 'optional',
      capabilityKey: 'mcp_tools',
      impactText: 'MCP tool integrations will not be available.',
    },
  ],
  tags: ['RAG', 'Chatbot', 'Documents', 'Search'],
  pipeline: [
    'speech-to-text',
    ['embeddings', 'vectordb'],
    'rerank',
    'text-generation',
    'text-to-speech',
    'mcp',
  ],
  image: sampleImage,
  demo: {
    type: 'component',
    component: RagChatbotDemo,
  },
}
