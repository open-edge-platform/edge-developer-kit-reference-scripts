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
    { serviceId: 'speech-to-text', role: 'required' },
    { serviceId: 'diarization', role: 'required' },
    { serviceId: 'text-generation', role: 'required', defaultDevice: 'GPU.1' },
  ],
  tags: ['Medical', 'Scribe', 'SOAP', 'Diarization', 'Transcription'],
  pipeline: ['speech-to-text', 'diarization', 'text-generation'],
  image: sampleImage,
  demo: {
    type: 'component',
    component: MedicalScribeDemo,
  },
}
