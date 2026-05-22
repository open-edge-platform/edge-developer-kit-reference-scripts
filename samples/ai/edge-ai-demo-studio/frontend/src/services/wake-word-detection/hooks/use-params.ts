// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import type { DemoParam } from '@/types/demo-params'
import type { AudioDevice } from '.'

export const WAKE_WORD_DEFAULTS = {
  detectionThreshold: 0.5,
  deviceId: 'default',
}

export interface WakeWordParamValues {
  detectionThreshold: number
  deviceId: string
}

export function useWakeWordParams(
  devices: AudioDevice[] = [],
  options?: {
    initial?: Partial<WakeWordParamValues>
    onRefreshDevices?: () => void
    isRefreshingDevices?: boolean
  },
): {
  values: WakeWordParamValues
  params: DemoParam[]
} {
  const initial = options?.initial
  const [detectionThreshold, setDetectionThreshold] = useState(
    initial?.detectionThreshold ?? WAKE_WORD_DEFAULTS.detectionThreshold,
  )
  const [deviceId, setDeviceId] = useState(
    initial?.deviceId ?? WAKE_WORD_DEFAULTS.deviceId,
  )

  const values: WakeWordParamValues = { detectionThreshold, deviceId }

  const deviceOptions = [
    { value: 'default', label: 'Default Microphone' },
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
      value: detectionThreshold,
      min: 0,
      max: 1,
      step: 0.05,
      onChange: setDetectionThreshold,
    },
    {
      type: 'select',
      id: 'audio_device',
      label: 'Audio Device',
      value: deviceId,
      options: deviceOptions,
      onChange: setDeviceId,
      onRefresh: options?.onRefreshDevices,
      isRefreshing: options?.isRefreshingDevices,
    },
  ]

  return { values, params }
}
