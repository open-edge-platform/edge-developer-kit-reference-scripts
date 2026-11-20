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
      label: 'Malaya (OpenVINO)',
      availableDevices: ['CPU'],
      availableWeightFormats: ['fp32'],
      backend: 'openvino',
    },
    {
      value: 'pocket-tts',
      // A checkpoint per language, picked by the voice: Kyutai's seven, loaded on first use, and an
      // Indonesian fine-tune, loaded at start.
      label: 'Pocket TTS (Multilingual, OpenVINO)',
      availableDevices: ['CPU'],
      availableWeightFormats: ['int8'],
      backend: 'openvino',
    },
    {
      // ONNX Runtime on CPU outran OpenVINO and PyTorch XPU here (see the vieneu worker README).
      value: 'vieneu',
      label: 'VieNeu-TTS v3 Turbo (ONNX Runtime)',
      availableDevices: ['CPU'],
      availableWeightFormats: ['int8'],
    },
    {
      value: 'fastspeech2-hs',
      label: 'FastSpeech2 HS (OpenVINO)',
      availableDevices: ['CPU'],
      availableWeightFormats: ['fp32'],
      backend: 'openvino',
    },
    {
      // Fun-CosyVoice3-0.5B (FunAudioLLM): voices cloned from recordings in models/tts/cosyvoice3/voices.
      // About real time everywhere: 1.9x on an Arc Pro B60 (AUTO's pick), 1.5x on a CPU or an
      // integrated GPU, where the worker runs fewer flow steps on an int8 DiT. Listed by its
      // speech-token LLM's INT8; the DiT is FP16 on a discrete GPU, and the vocoder FP32.
      value: 'cosyvoice3',
      label: 'CosyVoice 3 (Multilingual, cloned voices, OpenVINO)',
      availableDevices: ['AUTO', 'CPU', 'GPU'],
      availableWeightFormats: ['int8'],
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
