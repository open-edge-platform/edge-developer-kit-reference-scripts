// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { DemoParam } from '@/types/demo-params'
import { useDemoParams } from '@/services/common/demo/use-demo-params'
import type { AudioDevice } from '../lib/api'

/** `deviceId` of the worker's default microphone. */
export const DEFAULT_DEVICE = 'default'

const WAKE_WORD_DEFAULTS = {
  detectionThreshold: 0.5,
  deviceId: DEFAULT_DEVICE,
}

interface UseWakeWordParamsOptions {
  /** Keeps the settings per instance across remounts, under a `DemoSessionProvider`. */
  sessionKey?: string
}

/** The detection threshold (the only sidebar param) and the microphone, chosen beside Start. */
export function useWakeWordParams(
  devices: AudioDevice[],
  { sessionKey }: UseWakeWordParamsOptions,
) {
  const { values, setters } = useDemoParams(WAKE_WORD_DEFAULTS, { sessionKey })

  const deviceOptions = [
    { value: DEFAULT_DEVICE, label: 'Default microphone' },
    // The worker lists its own default as device -1.
    ...devices
      .filter((d) => d.id !== -1)
      .map((d) => ({ value: String(d.id), label: d.name })),
  ]

  const params: DemoParam[] = [
    {
      type: 'slider',
      id: 'detection_threshold',
      label: 'Detection Threshold',
      tooltip: 'Minimum confidence score to trigger a detection event.',
      value: values.detectionThreshold,
      min: 0,
      max: 1,
      step: 0.05,
      onChange: setters.setDetectionThreshold,
    },
  ]

  return {
    values,
    params,
    deviceOptions,
    setDeviceId: setters.setDeviceId,
  }
}
