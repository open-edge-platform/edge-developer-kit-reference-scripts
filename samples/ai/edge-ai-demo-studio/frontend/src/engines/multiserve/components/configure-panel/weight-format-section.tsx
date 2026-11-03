// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useId } from 'react'
import { InlineNotice } from '@/components/common/inline-notice'
import {
  ConfigSection,
  LabelWithTooltip,
} from '@/components/configure/config-section'
import { Input } from '@/components/ui/input'
import { KNOWN_QUANTIZATIONS } from '@/engines/multiserve/config'
import { isKnownWeightFormat } from '@/engines/multiserve/validation'

/** Weight format for the OpenVINO IR conversion; required for a model not named the OpenVINO way. */
export function WeightFormatSection({
  value,
  onChange,
}: {
  value: string
  onChange: (weightFormat: string) => void
}) {
  const fieldId = useId()
  return (
    <ConfigSection title="Weight Format">
      <InlineNotice tone="info">
        This model doesn&apos;t follow OpenVINO naming convention and requires
        conversion. Specify the weight format below.
      </InlineNotice>
      <LabelWithTooltip
        label="Weight format *"
        htmlFor={`${fieldId}-weight-format`}
        tooltip="Quantization format for model conversion (e.g., int4, int8, fp16)."
      />
      <Input
        id={`${fieldId}-weight-format`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g., int4, int8, fp16"
        className="text-xs"
        aria-invalid={!value.trim() || undefined}
      />
      {!value.trim() && (
        <p className="text-destructive text-xs">
          Required to convert this model.
        </p>
      )}
      {value && !isKnownWeightFormat(value) && (
        <p className="text-destructive text-xs">
          Unknown format. Known:{' '}
          {(KNOWN_QUANTIZATIONS as readonly string[]).join(', ')}
        </p>
      )}
    </ConfigSection>
  )
}
