// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { EMBEDDING_TYPE } from '@/lib/workloads/embedding'
import { IMAGE_GENERATION_TYPE } from '@/lib/workloads/image-generation'
import { LIPSYNC_TYPE } from '@/lib/workloads/lipsync'
import { SPEECH_TO_TEXT_TYPE } from '@/lib/workloads/speech-to-text'
import { TEXT_GENERATION_TYPE } from '@/lib/workloads/text-generation'
import { TEXT_TO_SPEECH_TYPE } from '@/lib/workloads/text-to-speech'
import { WAKE_WORD_DETECTION_TYPE } from '@/lib/workloads/wake-word-detection'
import {
  Brain,
  Speech,
  Volume2,
  FileSearch,
  User,
  Mic,
  ToolCase,
  Image,
  MessageCircle,
  MessageCircleWarning,
} from 'lucide-react'

export const samples = [
  {
    title: 'Digital Avatar',
    description: 'A digital avatar that can interact with users in real-time.',
    icon: User,
    href: '/digital-avatar',
    type: 'digital-avatar',
  },
  {
    title: 'Digital Avatar Lite',
    description:
      'A lightweight animated robot avatar that brings conversations to life with responsive movements and expressions.',
    icon: User,
    href: '/digital-avatar-lite',
    type: 'digital-avatar-lite',
  },
  {
    title: 'RAG Chat',
    description: 'A retrieval-augmented generation chat sample.',
    icon: MessageCircle,
    href: '/rag',
    type: 'rag',
  },
]

export const workloads = [
  {
    title: 'Wake Word Detection',
    description: 'Wake word detection for voice-activated applications',
    icon: MessageCircleWarning,
    type: WAKE_WORD_DETECTION_TYPE,
    href: '/wake-word-detection',
    useCases: ['Voice assistants', 'Smart devices', 'Hands-free control'],
  },
  {
    title: 'Speech-to-Text',
    description: 'Convert spoken words into accurate text transcriptions',
    icon: Mic,
    type: SPEECH_TO_TEXT_TYPE,
    href: '/speech-to-text',
    useCases: ['Voice assistants', 'Meeting transcription', 'Accessibility'],
  },
  {
    title: 'Embeddings',
    description: 'Generate embeddings and manage documents for RAG workflows',
    icon: FileSearch,
    href: '/embeddings',
    type: EMBEDDING_TYPE,
    useCases: ['Document search', 'RAG systems', 'Semantic similarity'],
  },
  {
    title: 'Text Generation',
    description: 'Generate human-like text using advanced language models',
    icon: Brain,
    href: '/text-generation',
    type: TEXT_GENERATION_TYPE,
    useCases: ['Content creation', 'Code generation', 'Chatbots'],
  },
  {
    title: 'MCP Manager',
    description: 'Manage and connect to multiple MCP servers seamlessly',
    icon: ToolCase,
    href: '/mcp-manager',
    type: 'mcp-manager',
    useCases: ['Manage MCP servers connections'],
  },
  {
    title: 'Text-to-Speech',
    description: 'Transform text into natural-sounding speech',
    icon: Volume2,
    type: TEXT_TO_SPEECH_TYPE,
    href: '/text-to-speech',
    useCases: ['Audiobooks', 'Voice assistants', 'Accessibility'],
  },
  {
    title: 'Lipsync',
    description: 'Synchronized lip movements and natural speech synthesis',
    icon: Speech,
    type: LIPSYNC_TYPE,
    href: '/lipsync',
    useCases: ['Virtual avatars', 'Video games', 'Accessibility'],
  },
  {
    title: 'Image Generation',
    description: 'Generate images from text prompts using diffusion models',
    icon: Image,
    href: '/image-generation',
    type: IMAGE_GENERATION_TYPE,
    useCases: ['Digital art', 'Content creation', 'Concept visualization'],
  },
]
