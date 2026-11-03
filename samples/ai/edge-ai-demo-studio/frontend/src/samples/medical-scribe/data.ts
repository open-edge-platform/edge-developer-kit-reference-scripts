// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Sample } from '../types'
import { MedicalScribeDemo } from './demo'
import sampleImage from './image.png'

export const sample: Sample = {
  id: 'medical-scribe',
  title: 'Medical Scribe',
  description:
    'Automatically transcribe and diarize doctor-patient conversations, then generate structured SOAP notes.',
  longDescription:
    'An AI-powered medical scribe that records doctor-patient conversations, transcribes them using speech-to-text, identifies speakers via diarization with doctor voice enrollment, and generates comprehensive SOAP (Subjective, Objective, Assessment, Plan) clinical notes using a language model.',
  category: ['Conversational AI'],
  dependencies: [
    { serviceId: 'medical-scribe-database', role: 'required' },
    {
      serviceId: 'speech-to-text',
      role: 'required',
      recommended: {
        device: 'GPU.0',
        // Whisper runs on both STT backends; Qwen3-ASR is OVMS-only and a recommended config
        // cannot switch `metadata.sttBackend`, so it would fail on the default OEP backend.
        model: 'openai/whisper-large-v3-turbo',
      },
    },
    {
      serviceId: 'diarization',
      role: 'required',
      recommended: {
        device: 'xpu:0',
        model: 'pyannote/speaker-diarization-community-1',
      },
    },
    {
      serviceId: 'text-generation',
      role: 'required',
      recommended: {
        device: 'GPU.0',
        model: 'OpenVINO/Qwen3-8B-int8-ov',
        backend: 'openvino',
      },
    },
  ],
  tags: ['Medical', 'Scribe', 'SOAP', 'Diarization', 'Transcription'],
  image: sampleImage,
  demo: {
    type: 'component',
    component: MedicalScribeDemo,
  },
}
