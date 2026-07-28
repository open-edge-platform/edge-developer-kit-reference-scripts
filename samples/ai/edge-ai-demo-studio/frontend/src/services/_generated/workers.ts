// THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY.
// Source of truth: scripts/generate-registries.mjs
// Run "npm run codegen" to regenerate.

import type { Service } from '@/payload-types'
import type { WorkerConfig } from '../types'

import { worker as diarizationWorker } from '../diarization/data'
import { worker as fileWatcherWorker } from '../file-watcher/data'
import { worker as getiClassifierWorker } from '../geti-classifier/data'
import { worker as imageBasedVideoSearchWorker } from '../suites/metro-ai-suite/image-based-video-search/data'
import { worker as imageGenerationWorker } from '../image-generation/data'
import { worker as lipsyncWorker } from '../lipsync/data'
import { worker as lossPreventionWorker } from '../suites/retail-ai-suite/loss-prevention/data'
import { worker as medicalScribeDatabaseWorker } from '../medical-scribe-database/data'
import { worker as ocrWorker } from '../ocr/data'
import { worker as palletDefectDetectionWorker } from '../suites/manufacturing-ai-suite/pallet-defect-detection/data'
import { worker as pptTranslatorWorker } from '../ppt-translator/data'
import { worker as roboticsAiWorker } from '../robotics-ai/data'
import { worker as speechToTextWorker } from '../speech-to-text/data'
import { worker as syntheticImageGenerationWorker } from '../synthetic-image-generation/data'
import { worker as textToSpeechWorker } from '../text-to-speech/data'
import { worker as vectordbWorker } from '../vectordb/data'
import { worker as wakeWordDetectionWorker } from '../wake-word-detection/data'

/** Worker configuration registry keyed by Payload service type. */
const workerRegistry: Partial<Record<Service['type'], WorkerConfig>> = {
  diarization: diarizationWorker,
  'file-watcher': fileWatcherWorker,
  'geti-classifier': getiClassifierWorker,
  'image-based-video-search': imageBasedVideoSearchWorker,
  'image-generation': imageGenerationWorker,
  lipsync: lipsyncWorker,
  'loss-prevention': lossPreventionWorker,
  'medical-scribe-database': medicalScribeDatabaseWorker,
  ocr: ocrWorker,
  'pallet-defect-detection': palletDefectDetectionWorker,
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
