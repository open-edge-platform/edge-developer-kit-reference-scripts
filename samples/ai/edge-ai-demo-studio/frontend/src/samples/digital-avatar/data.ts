// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Sample } from '../types'
import { DigitalAvatarDemo } from './demo'
import sampleImage from './image.png'

export const sample: Sample = {
  id: 'digital-avatar',
  title: 'Digital Avatar',
  description:
    'Interact with an AI-powered avatar that combines real-time video with intelligent conversation.',
  longDescription:
    'A digital avatar experience powered by real-time lip-syncing with Wav2Lip, streamed over WebRTC. Combines text generation, text-to-speech, and lipsync services for a lifelike conversational AI avatar. Optionally supports voice input via STT, knowledge retrieval via RAG, MCP tool integrations, and wake word detection for hands-free interaction.',
  category: ['Conversational AI'],
  dependencies: [
    {
      serviceId: 'wake-word-detection',
      role: 'optional',
      capabilityKey: 'wake_word',
      impactText: 'Wake word detection will be disabled.',
    },
    {
      serviceId: 'speech-to-text',
      role: 'optional',
      capabilityKey: 'voice_input',
      impactText: 'Voice input will be disabled.',
    },
    { serviceId: 'text-generation', role: 'required', defaultDevice: 'GPU.1' },
    {
      serviceId: 'embeddings',
      role: 'optional',
      capabilityKey: 'rag',
      impactText: 'Document-based knowledge retrieval will be unavailable.',
    },
    {
      serviceId: 'rerank',
      role: 'optional',
      capabilityKey: 'rag',
      impactText: 'Search results will not be reranked for relevance.',
    },
    {
      serviceId: 'vectordb',
      role: 'optional',
      capabilityKey: 'rag',
      impactText: 'Vector search for RAG will be unavailable.',
    },
    {
      serviceId: 'mcp',
      role: 'optional',
      capabilityKey: 'mcp_tools',
      impactText: 'MCP tool integrations will not be available.',
    },
    { serviceId: 'text-to-speech', role: 'required' },
    { serviceId: 'lipsync', role: 'required', defaultDevice: 'xpu' },
  ],
  pipeline: [
    'wake-word-detection',
    'speech-to-text',
    ['embeddings', 'vectordb', 'rerank'],
    'text-generation',
    'text-to-speech',
    'lipsync',
    'mcp',
  ],
  tags: ['Avatar', 'WebRTC', 'Lipsync', 'Conversational AI'],
  image: sampleImage,
  demo: {
    type: 'component',
    component: DigitalAvatarDemo,
  },
}
