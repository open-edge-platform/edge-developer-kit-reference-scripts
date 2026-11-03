// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { SegmentedChoiceSection } from './segmented-choice-section'

const DESCRIPTIONS: Record<string, string> = {
  auto: 'The worker picks the precision that suits the device it runs on.',
  fp32: 'Full precision: the largest export and the reference accuracy.',
  fp16: 'Half the size of FP32 with practically the same accuracy.',
  int8: 'About a quarter of the size of FP32 and usually faster, with results close to it.',
  int4: 'The smallest and quickest to load; accuracy drops more noticeably.',
}

/** `int8` → "INT8", `auto` → "Auto". */
export function precisionLabel(format: string): string {
  return format === 'auto' ? 'Auto' : format.toUpperCase()
}

/**
 * The drafted model's precision (weight format): a button per format it can be converted to, or its
 * one fixed format, shown so the precision is still known.
 */
export function PrecisionSection({
  formats,
  defaultFormat,
  value,
  onChange,
}: {
  formats: string[]
  defaultFormat: string
  value: string
  onChange: (format: string) => void
}) {
  if (formats.length === 1) {
    const [fixed] = formats
    return (
      <SegmentedChoiceSection
        title="Precision"
        ariaLabel="Model precision"
        options={[
          {
            value: fixed,
            label: precisionLabel(fixed),
            description: DESCRIPTIONS[fixed],
          },
        ]}
        value={fixed}
        onChange={onChange}
        hint={`This model comes with ${precisionLabel(fixed)} weights only, so there is nothing to choose.`}
        testId="cfg-precision"
        optionTestId={(format) => `cfg-precision-option-${format}`}
      />
    )
  }
  return (
    <SegmentedChoiceSection
      title="Precision"
      ariaLabel="Model precision"
      options={formats.map((format) => ({
        value: format,
        label:
          format === defaultFormat
            ? `${precisionLabel(format)} (default)`
            : precisionLabel(format),
        description: DESCRIPTIONS[format],
      }))}
      value={value}
      onChange={onChange}
      hint="The model is converted to this precision on its next start, once per precision. Models downloaded already in OpenVINO format keep their own."
      testId="cfg-precision"
      optionTestId={(format) => `cfg-precision-option-${format}`}
    />
  )
}
