// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Sample } from '../types'
import { PptTranslatorDemo } from './demo'

export const sample: Sample = {
  id: 'ppt-translator',
  title: 'PowerPoint Translator',
  description:
    'Translate PowerPoint presentations while preserving formatting using AI.',
  longDescription:
    'Upload a PowerPoint file and translate it to another language while preserving all slide formatting, fonts, and layout. Supports 15 languages, speaker notes translation, proper noun preservation, and automatic font size adjustment for translated text.',
  category: ['Productivity'],
  dependencies: [
    { serviceId: 'ppt-translator', role: 'required' },
    { serviceId: 'text-generation', role: 'required', defaultDevice: 'GPU.1' },
  ],
  tags: ['Translation', 'PowerPoint', 'LLM', 'Document'],
  supportedOS: ['linux', 'windows'],
  demo: {
    type: 'component',
    component: PptTranslatorDemo,
  },
}
