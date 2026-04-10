// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceConfig } from '@/services/types'

/** Predefined OpenWakeWord models available for download. */
const MODELS = [
  { value: 'hey_jarvis_v0.1.onnx', label: 'Hey Jarvis' },
  { value: 'alexa_v0.1.onnx', label: 'Alexa' },
  { value: 'hey_mycroft_v0.1.onnx', label: 'Hey Mycroft' },
  { value: 'hey_rhasspy_v0.1.onnx', label: 'Hey Rhasspy' },
  { value: 'timer_v0.1.onnx', label: 'Timer' },
  { value: 'weather_v0.1.onnx', label: 'Weather' },
]

const WWD_DEVICES = ['CPU']
const WWD_BACKEND = 'pytorch'

export const serviceConfig: ServiceConfig = {
  availableModels: MODELS.map((m) => ({
    ...m,
    availableDevices: WWD_DEVICES,
    backend: WWD_BACKEND,
  })),
}
