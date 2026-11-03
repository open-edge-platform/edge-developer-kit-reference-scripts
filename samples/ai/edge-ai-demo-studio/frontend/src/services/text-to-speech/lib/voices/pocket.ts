// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { VoiceInfo } from './types'

/** Each voice is cloned from a Common Voice recording shipped in the model repository. */
export const POCKET_VOICES: VoiceInfo[] = [
  { id: 'female_1', label: 'Female 1', language: 'Indonesian' },
  { id: 'female_2', label: 'Female 2', language: 'Indonesian' },
  { id: 'male_1', label: 'Male 1', language: 'Indonesian' },
  { id: 'male_2', label: 'Male 2', language: 'Indonesian' },
]
