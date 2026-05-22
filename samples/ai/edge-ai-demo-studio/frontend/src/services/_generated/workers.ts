// THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY.
// Source of truth: scripts/generate-registries.mjs
// Run "npm run codegen" to regenerate.

import type { Service } from '@/payload-types'
import type { WorkerConfig } from '../types'

import { worker as diarizationWorker } from '../diarization/data'
import { worker as getiClassifierWorker } from '../geti-classifier/data'
import { worker as imageGenerationWorker } from '../image-generation/data'
import { worker as lipsyncWorker } from '../lipsync/data'
import { worker as medicalScribeDatabaseWorker } from '../medical-scribe-database/data'
import { worker as pptTranslatorWorker } from '../ppt-translator/data'
import { worker as roboticsAiWorker } from '../robotics-ai/data'
import { worker as speechToTextWorker } from '../speech-to-text/data'
import { worker as syntheticImageGenerationWorker } from '../synthetic-image-generation/data'
import { worker as textToSpeechWorker } from '../text-to-speech/data'
import { worker as vectordbWorker } from '../vectordb/data'
import { worker as wakeWordDetectionWorker } from '../wake-word-detection/data'

/** Worker configuration registry keyed by Payload service type. */
export const workerRegistry: Partial<Record<Service['type'], WorkerConfig>> = {
  diarization: diarizationWorker,
  'geti-classifier': getiClassifierWorker,
  'image-generation': imageGenerationWorker,
  lipsync: lipsyncWorker,
  'medical-scribe-database': medicalScribeDatabaseWorker,
  'ppt-translator': pptTranslatorWorker,
  'robotics-ai': roboticsAiWorker,
  'speech-to-text': speechToTextWorker,
  'synthetic-image-generation': syntheticImageGenerationWorker,
  'text-to-speech': textToSpeechWorker,
  vectordb: vectordbWorker,
  'wake-word-detection': wakeWordDetectionWorker,
}

export function getWorkerConfig(
  type: Service['type'],
): WorkerConfig | undefined {
  return workerRegistry[type]
}
