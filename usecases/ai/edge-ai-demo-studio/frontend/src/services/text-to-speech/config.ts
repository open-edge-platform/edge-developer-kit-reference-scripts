// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceConfig } from '@/services/types'

// ─── Voice Definitions ───────────────────────────────────────────

export interface VoiceInfo {
  id: string
  label: string
  language: string
}

interface VoiceLanguage {
  code: string
  label: string
}

/** Languages supported by the Kokoro model (prefix → language). */
export const KOKORO_LANGUAGES: VoiceLanguage[] = [
  { code: 'a', label: 'English (American)' },
  { code: 'b', label: 'English (British)' },
  { code: 'e', label: 'Spanish' },
  { code: 'f', label: 'French' },
  { code: 'h', label: 'Hindi' },
  { code: 'i', label: 'Italian' },
  { code: 'j', label: 'Japanese' },
  { code: 'p', label: 'Portuguese' },
  { code: 'z', label: 'Chinese' },
]

/** All voices available in the Kokoro model. */
export const KOKORO_VOICES: VoiceInfo[] = [
  // American English — Female
  { id: 'af_heart', label: 'Heart', language: 'English (American)' },
  { id: 'af_alloy', label: 'Alloy', language: 'English (American)' },
  { id: 'af_aoede', label: 'Aoede', language: 'English (American)' },
  { id: 'af_bella', label: 'Bella', language: 'English (American)' },
  { id: 'af_jadzia', label: 'Jadzia', language: 'English (American)' },
  { id: 'af_jessica', label: 'Jessica', language: 'English (American)' },
  { id: 'af_kore', label: 'Kore', language: 'English (American)' },
  { id: 'af_nicole', label: 'Nicole', language: 'English (American)' },
  { id: 'af_nova', label: 'Nova', language: 'English (American)' },
  { id: 'af_river', label: 'River', language: 'English (American)' },
  { id: 'af_sarah', label: 'Sarah', language: 'English (American)' },
  { id: 'af_sky', label: 'Sky', language: 'English (American)' },
  // American English — Male
  { id: 'am_adam', label: 'Adam', language: 'English (American)' },
  { id: 'am_echo', label: 'Echo', language: 'English (American)' },
  { id: 'am_eric', label: 'Eric', language: 'English (American)' },
  { id: 'am_fenrir', label: 'Fenrir', language: 'English (American)' },
  { id: 'am_liam', label: 'Liam', language: 'English (American)' },
  { id: 'am_michael', label: 'Michael', language: 'English (American)' },
  { id: 'am_onyx', label: 'Onyx', language: 'English (American)' },
  { id: 'am_puck', label: 'Puck', language: 'English (American)' },
  { id: 'am_santa', label: 'Santa', language: 'English (American)' },
  // British English — Female
  { id: 'bf_alice', label: 'Alice', language: 'English (British)' },
  { id: 'bf_emma', label: 'Emma', language: 'English (British)' },
  { id: 'bf_lily', label: 'Lily', language: 'English (British)' },
  // British English — Male
  { id: 'bm_daniel', label: 'Daniel', language: 'English (British)' },
  { id: 'bm_fable', label: 'Fable', language: 'English (British)' },
  { id: 'bm_george', label: 'George', language: 'English (British)' },
  { id: 'bm_lewis', label: 'Lewis', language: 'English (British)' },
  // Spanish
  { id: 'ef_dora', label: 'Dora', language: 'Spanish' },
  { id: 'em_alex', label: 'Alex', language: 'Spanish' },
  { id: 'em_santa', label: 'Santa', language: 'Spanish' },
  // French
  { id: 'ff_siwis', label: 'Siwis', language: 'French' },
  // Hindi
  { id: 'hf_alpha', label: 'Alpha', language: 'Hindi' },
  { id: 'hf_beta', label: 'Beta', language: 'Hindi' },
  { id: 'hm_omega', label: 'Omega', language: 'Hindi' },
  { id: 'hm_psi', label: 'Psi', language: 'Hindi' },
  // Italian
  { id: 'if_sara', label: 'Sara', language: 'Italian' },
  { id: 'im_nicola', label: 'Nicola', language: 'Italian' },
  // Japanese
  { id: 'jf_alpha', label: 'Alpha', language: 'Japanese' },
  { id: 'jf_gongitsune', label: 'Gongitsune', language: 'Japanese' },
  { id: 'jf_nezumi', label: 'Nezumi', language: 'Japanese' },
  { id: 'jf_tebukuro', label: 'Tebukuro', language: 'Japanese' },
  { id: 'jm_kumo', label: 'Kumo', language: 'Japanese' },
  // Portuguese
  { id: 'pf_dora', label: 'Dora', language: 'Portuguese' },
  { id: 'pm_alex', label: 'Alex', language: 'Portuguese' },
  { id: 'pm_santa', label: 'Santa', language: 'Portuguese' },
  // Chinese
  { id: 'zf_xiaobei', label: 'Xiaobei', language: 'Chinese' },
  { id: 'zf_xiaoni', label: 'Xiaoni', language: 'Chinese' },
  { id: 'zf_xiaoxiao', label: 'Xiaoxiao', language: 'Chinese' },
  { id: 'zf_xiaoyi', label: 'Xiaoyi', language: 'Chinese' },
  { id: 'zm_yunjian', label: 'Yunjian', language: 'Chinese' },
  { id: 'zm_yunxi', label: 'Yunxi', language: 'Chinese' },
  { id: 'zm_yunxia', label: 'Yunxia', language: 'Chinese' },
  { id: 'zm_yunyang', label: 'Yunyang', language: 'Chinese' },
]

/** All voices available in the Malaya model. */
export const MALAYA_VOICES: VoiceInfo[] = [
  { id: 'Husein', label: 'Husein', language: 'Malay' },
  { id: 'Shafiqah Idayu', label: 'Shafiqah Idayu', language: 'Malay' },
  { id: 'Anwar Ibrahim', label: 'Anwar Ibrahim', language: 'Malay' },
]

/** Return the predefined voice list for a given model. */
export function getVoicesForModel(model: string): VoiceInfo[] {
  if (model === 'malaya') return MALAYA_VOICES
  return KOKORO_VOICES
}

/** Return the unique language list for a given model. */
export function getLanguagesForModel(
  model: string,
): { value: string; label: string }[] {
  const voices = getVoicesForModel(model)
  const seen = new Set<string>()
  const result: { value: string; label: string }[] = []
  for (const v of voices) {
    if (!seen.has(v.language)) {
      seen.add(v.language)
      result.push({ value: v.language, label: v.language })
    }
  }
  return result
}

// ─── Service Config ──────────────────────────────────────────────

export const ttsConfig: ServiceConfig = {
  availableModels: [
    {
      value: 'kokoro',
      label: 'Kokoro (Multilingual, OpenVINO)',
      availableDevices: ['CPU'],
      backend: 'openvino',
    },
    {
      value: 'malaya',
      label: 'Malaya (Malay, VITS)',
      availableDevices: ['CPU', 'XPU'],
      backend: 'pytorch',
    },
  ],
}
