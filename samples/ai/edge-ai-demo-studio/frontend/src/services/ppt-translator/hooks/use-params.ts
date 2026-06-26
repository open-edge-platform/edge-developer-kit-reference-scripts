// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'

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
  const [sourceLanguage, setSourceLanguage] = useState(
    initial?.sourceLanguage ?? DEFAULTS.sourceLanguage,
  )
  const [targetLanguage, setTargetLanguage] = useState(
    initial?.targetLanguage ?? DEFAULTS.targetLanguage,
  )
  const [preserveProperNouns, setPreserveProperNouns] = useState(
    initial?.preserveProperNouns ?? DEFAULTS.preserveProperNouns,
  )
  const [translateSpeakerNotes, setTranslateSpeakerNotes] = useState(
    initial?.translateSpeakerNotes ?? DEFAULTS.translateSpeakerNotes,
  )
  const [autoAdjustFontSize, setAutoAdjustFontSize] = useState(
    initial?.autoAdjustFontSize ?? DEFAULTS.autoAdjustFontSize,
  )
  const [presentationContext, setPresentationContext] = useState(
    initial?.presentationContext ?? DEFAULTS.presentationContext,
  )
  const [model, setModel] = useState(initial?.model ?? DEFAULTS.model)

  return {
    values: {
      sourceLanguage,
      targetLanguage,
      preserveProperNouns,
      translateSpeakerNotes,
      autoAdjustFontSize,
      presentationContext,
      model,
    },
    setters: {
      setSourceLanguage,
      setTargetLanguage,
      setPreserveProperNouns,
      setTranslateSpeakerNotes,
      setAutoAdjustFontSize,
      setPresentationContext,
      setModel,
    },
  }
}
