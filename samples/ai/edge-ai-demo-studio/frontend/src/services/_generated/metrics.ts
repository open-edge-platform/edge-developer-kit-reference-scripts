// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY.
// Source of truth: scripts/generate-registries.mjs
// Run "npm run codegen" to regenerate.

import type { MetricFigure } from '../common/metrics/types'

import { figures as diarizationFigures } from '../diarization/metrics'
import { figures as embeddingsFigures } from '../embeddings/metrics'
import { figures as faceRecognitionFigures } from '../face-recognition/metrics'
import { figures as frameGenerationFigures } from '../frame-generation/metrics'
import { figures as imageGenerationFigures } from '../image-generation/metrics'
import { figures as ocrFigures } from '../ocr/metrics'
import { figures as rerankFigures } from '../rerank/metrics'
import { figures as speechToTextFigures } from '../speech-to-text/metrics'
import { figures as textGenerationFigures } from '../text-generation/metrics'
import { figures as textToSpeechFigures } from '../text-to-speech/metrics'

/** Figures of each service's Live metrics panel (`metrics.tsx`), keyed by service ID. */
export const metricsRegistry: Partial<Record<string, MetricFigure[]>> = {
  diarization: diarizationFigures,
  embeddings: embeddingsFigures,
  'face-recognition': faceRecognitionFigures,
  'frame-generation': frameGenerationFigures,
  'image-generation': imageGenerationFigures,
  ocr: ocrFigures,
  rerank: rerankFigures,
  'speech-to-text': speechToTextFigures,
  'text-generation': textGenerationFigures,
  'text-to-speech': textToSpeechFigures,
}
