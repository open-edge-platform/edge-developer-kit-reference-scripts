// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { VoiceInfo } from './types'

// OEP voices ship with the model; upstream synthesises English only at the pinned release.

// Named x-vector voices bundled with upstream (components/tts/speecht5_voices.py).
export const SPEECHT5_VOICES: VoiceInfo[] = [
  { id: 'Ryan', label: 'Ryan (male, bright)', language: 'English' },
  { id: 'Miles', label: 'Miles (male, full)', language: 'English' },
  { id: 'Aaron', label: 'Aaron (male, deep)', language: 'English' },
  { id: 'Nora', label: 'Nora (female, warm)', language: 'English' },
  { id: 'Elena', label: 'Elena (female, soft)', language: 'English' },
  { id: 'Kabir', label: 'Kabir (male, crisp)', language: 'English' },
  { id: 'Angus', label: 'Angus (male, slow paced)', language: 'English' },
]
