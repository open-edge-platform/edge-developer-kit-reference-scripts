// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Brain, Speech, Volume2, FileSearch, User, Mic } from 'lucide-react'

export const samples = [
  {
    title: 'Digital Avatar',
    description: 'A digital avatar that can interact with users in real-time.',
    icon: User,
    href: '/digital-avatar',
    type: 'digital-avatar',
    useCases: [
      'Virtual assistants',
      'Customer support',
      'Interactive storytelling',
    ],
  },
]

export const workloads = [
  {
    title: 'Speech-to-Text',
    description: 'Convert spoken words into accurate text transcriptions',
    icon: Mic,
    type: 'speech-to-text',
    href: '/speech-to-text',
    useCases: ['Voice assistants', 'Meeting transcription', 'Accessibility'],
  },
  {
    title: 'Embedding',
    description: 'Generate embeddings and manage documents for RAG workflows',
    icon: FileSearch,
    href: '/embedding',
    type: 'embedding',
    useCases: ['Document search', 'RAG systems', 'Semantic similarity'],
  },
  {
    title: 'Text Generation',
    description: 'Generate human-like text using advanced language models',
    icon: Brain,
    href: '/text-generation',
    type: 'text-generation',
    useCases: ['Content creation', 'Code generation', 'Chatbots'],
  },
  {
    title: 'Text-to-Speech',
    description: 'Transform text into natural-sounding speech',
    icon: Volume2,
    type: 'text-to-speech',
    href: '/text-to-speech',
    useCases: ['Audiobooks', 'Voice assistants', 'Accessibility'],
  },
  {
    title: 'Lipsync',
    description: 'Synchronized lip movements and natural speech synthesis',
    icon: Speech,
    type: 'lipsync',
    href: '/lipsync',
    useCases: ['Virtual avatars', 'Video games', 'Accessibility'],
  },
]
