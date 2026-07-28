// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Sample } from '../types'
import { DigitalAvatarLiteDemo } from './demo'
import sampleImage from './image.png'

export const sample: Sample = {
  id: 'digital-avatar-lite',
  title: 'Digital Avatar Lite',
  description:
    'A lightweight animated robot avatar that brings conversations to life with responsive movements and expressions.',
  longDescription:
    'A lightweight digital avatar experience using MJPEG image streaming instead of WebRTC. Combines text generation and text-to-speech for an animated conversational avatar with responsive movements and expressions. Optionally supports voice input via STT, knowledge retrieval via RAG, MCP tool integrations, and wake word detection.',
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
    {
      serviceId: 'text-generation',
      role: 'required',
      recommended: {
        device: 'GPU.1',
      },
    },
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
      impactText: 'Knowledge rerank will be unavailable',
    },
    {
      serviceId: 'vectordb',
      role: 'optional',
      capabilityKey: 'rag',
      impactText: 'Vector search for RAG will be unavailable.',
    },
    { serviceId: 'text-to-speech', role: 'required' },
    {
      serviceId: 'mcp',
      role: 'optional',
      capabilityKey: 'mcp_tools',
      impactText: 'MCP tool integrations will not be available.',
    },
  ],
  tags: ['Avatar', 'Animated', 'Lightweight', 'Conversational AI'],
  pipeline: [
    'wake-word-detection',
    'speech-to-text',
    ['embeddings', 'vectordb', 'rerank'],
    'text-generation',
    'mcp',
    'text-to-speech',
  ],
  image: sampleImage,
  demo: {
    type: 'component',
    component: DigitalAvatarLiteDemo,
  },
}
