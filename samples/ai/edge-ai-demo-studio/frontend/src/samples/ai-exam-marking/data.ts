// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Sample } from '../types'
import { AiExamMarkingDemo } from './demo'

export const sample: Sample = {
  id: 'ai-exam-marking',
  title: 'AI Exam Marking',
  description:
    'AI-powered exam marking using OCR and LLM to automatically grade test papers from images',
  longDescription:
    'AI Exam Marking leverages OCR and LLM technologies to automatically grade test papers from images. This project demonstrates the integration of AI models for efficient and accurate exam evaluation, reducing manual grading efforts and improving consistency.',
  category: ['Education'],
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
    { serviceId: 'text-generation', role: 'required' },
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
  tags: ['VLM', 'OCR', 'LLM', 'Multimodal', 'Education'],
  supportedOS: ['linux', 'windows'],
  demo: {
    type: 'component',
    component: AiExamMarkingDemo,
  },
}
