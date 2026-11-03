// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceConfig } from '@/services/types'

/** Used when an instance names no model, and by the demo until the instance reports its own. */
export const DEFAULT_TTS_MODEL = 'kokoro'

// OEP model, served by workers/services/text-to-speech/oep-tts. Upstream's Qwen3-TTS is left out:
// its qwen-tts package pins a transformers release with known CVEs (see the worker's README).
const SPEECHT5_MODEL = 'microsoft/speecht5_tts'

export const ttsConfig: ServiceConfig = {
  // OEP models are exported at this precision on first start (upstream `--dtype`); the built-in
  // workers each have a fixed one.
  availableWeightFormats: ['fp32', 'fp16', 'int8', 'int4'],
  defaultWeightFormat: 'int8',
  availableModels: [
    {
      value: 'kokoro',
      label: 'Kokoro (Multilingual, OpenVINO)',
      availableDevices: ['AUTO', 'CPU', 'GPU', 'NPU'],
      availableWeightFormats: ['fp16'],
      backend: 'openvino',
    },
    {
      value: 'malaya',
      label: 'Malaya (Malay, OpenVINO)',
      availableDevices: ['CPU'],
      availableWeightFormats: ['fp32'],
      backend: 'openvino',
    },
    {
      value: 'pocket-tts',
      label: 'Pocket TTS (Indonesian, OpenVINO)',
      availableDevices: ['CPU'],
      availableWeightFormats: ['int8'],
      backend: 'openvino',
    },
    {
      // ONNX Runtime on CPU outran OpenVINO and PyTorch XPU here (see the vieneu worker README).
      value: 'vieneu',
      label: 'VieNeu-TTS v3 Turbo (Vietnamese, ONNX Runtime)',
      availableDevices: ['CPU'],
      availableWeightFormats: ['int8'],
    },
    {
      value: 'fastspeech2-hs',
      label: 'FastSpeech2 HS (Tamil, OpenVINO)',
      availableDevices: ['CPU'],
      availableWeightFormats: ['fp32'],
      backend: 'openvino',
    },
    {
      value: 'piper',
      label: 'Piper (Multilingual, OpenVINO)',
      availableDevices: ['AUTO', 'CPU', 'GPU'],
      availableWeightFormats: ['fp16'],
      backend: 'openvino',
    },
    {
      value: SPEECHT5_MODEL,
      label: 'SpeechT5 (English, OpenVINO, OEP)',
      availableDevices: ['AUTO', 'CPU', 'GPU'],
      backend: 'openvino',
    },
  ],
}
