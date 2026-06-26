// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Sample } from '../types'
import { WebcamVlmDemo } from './demo'
import sampleImage from './image.png'

export const sample: Sample = {
  id: 'webcam-vlm',
  title: 'Webcam Capture with VLM',
  description:
    'Demonstrate the integration of webcam capture and Visual Language Model (VLM) for enhanced interaction.',
  longDescription:
    'Combines live webcam capture with a Visual Language Model (VLM) for multimodal conversational AI. Capture images from your webcam and discuss them with an AI that understands visual context. Optionally supports voice input via STT, voice output via TTS, knowledge retrieval via RAG, MCP tool integrations, and wake word detection.',
  category: ['Vision'],
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
  pipeline: [
    'wake-word-detection',
    'speech-to-text',
    ['embeddings', 'vectordb', 'rerank'],
    'text-generation',
    'text-to-speech',
    'mcp',
  ],
  tags: ['Webcam', 'VLM', 'Multimodal', 'Vision'],
  image: sampleImage,
  demo: {
    type: 'component',
    component: WebcamVlmDemo,
  },
}
