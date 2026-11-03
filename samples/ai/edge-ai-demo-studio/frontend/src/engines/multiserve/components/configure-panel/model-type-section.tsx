// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useId } from 'react'
import {
  ConfigSection,
  LabelWithTooltip,
} from '@/components/configure/config-section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MODEL_TYPES } from '@/engines/multiserve/config'
import type { ModelUsage } from '@/engines/multiserve/types'

/** How a llama.cpp model runs: text only, or multimodal (VLM). */
export function ModelTypeSection({
  value,
  onChange,
}: {
  value: ModelUsage
  onChange: (modelType: ModelUsage) => void
}) {
  const fieldId = useId()
  return (
    <ConfigSection title="Model Type">
      <LabelWithTooltip
        label="Inference type"
        htmlFor={`${fieldId}-model-type`}
        tooltip="Select 'Multimodal (VLM)' for vision-language models that accept image inputs."
      />
      <Select
        value={value}
        onValueChange={(v) =>
          onChange(v === 'multimodal' ? 'multimodal' : 'default')
        }
      >
        <SelectTrigger id={`${fieldId}-model-type`} className="w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MODEL_TYPES.map((mt) => (
            <SelectItem key={mt.value} value={mt.value} className="text-xs">
              {mt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </ConfigSection>
  )
}
