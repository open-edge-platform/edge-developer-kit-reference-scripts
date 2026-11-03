// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useParamState } from '@/hooks/use-param-state'

export const SUPPORTED_LANGUAGES = [
  'English',
  'Simplified Chinese',
  'Traditional Chinese',
  'Spanish',
  'French',
  'German',
  'Japanese',
  'Korean',
  'Italian',
  'Portuguese',
  'Russian',
  'Arabic',
  'Hindi',
  'Thai',
  'Vietnamese',
] as const

export interface PptTranslatorParamValues {
  sourceLanguage: string
  targetLanguage: string
  preserveProperNouns: boolean
  translateSpeakerNotes: boolean
  autoAdjustFontSize: boolean
  presentationContext: string
  model: string
}

const DEFAULTS: PptTranslatorParamValues = {
  sourceLanguage: 'English',
  targetLanguage: 'Simplified Chinese',
  preserveProperNouns: false,
  translateSpeakerNotes: true,
  autoAdjustFontSize: true,
  presentationContext: '',
  model: 'Qwen3-8B-int4-ov',
}

export function usePptTranslatorParams(
  initial?: Partial<PptTranslatorParamValues>,
) {
  const { values, setters } = useParamState(DEFAULTS, initial)
  return { values, setters }
}
