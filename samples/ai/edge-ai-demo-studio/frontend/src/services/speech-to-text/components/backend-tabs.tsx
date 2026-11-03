// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { SegmentedChoiceSection } from '@/services/common/configure/segmented-choice-section'
import { STT_BACKEND_OPTIONS, type SttBackendId } from '../config'

/**
 * Backend choice (OEP audio-analyzer or OVMS worker). A draft field: choosing swaps the model list
 * and sends nothing; the saved backend applies on the instance's next (re)start.
 */
export function SttBackendTabs({
  value,
  onChange,
  isDraft,
}: {
  value: SttBackendId
  onChange: (backend: SttBackendId) => void
  /** Drafting a new instance rather than changing an existing one. */
  isDraft: boolean
}) {
  return (
    <SegmentedChoiceSection
      title="Backend"
      ariaLabel="Speech to Text backend"
      testId="stt-backend-tabs"
      optionTestId={(backend) => `stt-backend-option-${backend}`}
      options={STT_BACKEND_OPTIONS}
      value={value}
      onChange={onChange}
      hint={
        isDraft
          ? 'Choose which backend this instance starts on.'
          : 'Saved with the other settings. The model list follows the backend; a model the other backend cannot run is replaced by the default one.'
      }
      tooltips
    />
  )
}
