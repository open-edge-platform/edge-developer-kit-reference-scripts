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
import { OVMS_PIPELINE_TYPES } from '@/engines/multiserve/config'

/** How OVMS serves an OpenVINO model (text, VLM, …). */
export function PipelineTypeSection({
  value,
  onChange,
}: {
  value: string
  onChange: (pipelineType: string) => void
}) {
  const fieldId = useId()
  return (
    <ConfigSection title="Pipeline Type">
      <LabelWithTooltip
        label="Pipeline type"
        htmlFor={`${fieldId}-pipeline`}
        tooltip="Determines how the model is served. VLM/VLM_CB enables vision-language (multimodal) mode."
      />
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={`${fieldId}-pipeline`} className="w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OVMS_PIPELINE_TYPES.map((pt) => (
            <SelectItem key={pt.value} value={pt.value} className="text-xs">
              {pt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </ConfigSection>
  )
}
