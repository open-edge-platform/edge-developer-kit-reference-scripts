// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { DIARIZATION_DEFAULTS } from '@/services/diarization/hooks'
import type { LiveDiarizationConfig } from '@/services/diarization/lib/live-protocol'
import type { DoctorProfile } from './types'

/**
 * How diarization names a consultation's speakers, the same live and once processed: Doctor and
 * Patient by the doctor's voice print, else two speakers. Live, the recording so far may hold one
 * voice yet, so it is at most two rather than exactly two.
 */
export function speakerNaming(
  profile: DoctorProfile | undefined,
  { live }: { live: boolean },
): LiveDiarizationConfig {
  const speakerMatchThreshold = DIARIZATION_DEFAULTS.speakerMatchThreshold
  if (profile?.embedding) {
    return {
      referenceEmbedding: profile.embedding,
      referenceLabel: 'Doctor',
      otherLabel: 'Patient',
      speakerMatchThreshold,
    }
  }
  return live
    ? { maxSpeakers: 2, speakerMatchThreshold }
    : { numSpeakers: 2, speakerMatchThreshold }
}
