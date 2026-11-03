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
import { resolveDeviceOptions, useDevicesQuery } from '@/hooks/use-devices'

/** No device of its own: the noise suppression model runs where the speech model does. */
export const SAME_AS_MODEL = 'same'

const DENOISE_DEVICES = ['AUTO', 'CPU', 'GPU', 'NPU']

/** Where the OVMS backend runs its noise suppression model (`metadata.denoiseDevice`). */
export function DenoiseDeviceSection({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const fieldId = useId()
  const { data: devices } = useDevicesQuery('openvino')
  const options = resolveDeviceOptions(DENOISE_DEVICES, devices, 'openvino')
  // A device saved elsewhere (deployment.json) is listed too, so the trigger shows what is saved.
  const listed =
    value === SAME_AS_MODEL ||
    options.some((o) => o.value.toLowerCase() === value.toLowerCase())
      ? options
      : [...options, { value, label: value }]

  return (
    <ConfigSection title="Noise Suppression" className="space-y-2">
      <LabelWithTooltip
        label="Device"
        htmlFor={`${fieldId}-denoise-device`}
        tooltip="Runs the noise suppression model of requests sent with use_denoise. It falls back to CPU when the model cannot compile on the device chosen."
      />
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          id={`${fieldId}-denoise-device`}
          data-testid="cfg-denoise-device-select"
          className="w-full text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SAME_AS_MODEL} className="text-xs">
            Same as the speech model
          </SelectItem>
          {listed.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-muted-foreground text-xs">
        Moving it off the speech model&apos;s accelerator leaves that one to
        transcription.
      </p>
    </ConfigSection>
  )
}
