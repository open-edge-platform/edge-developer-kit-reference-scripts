// THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY.
// Source of truth: scripts/generate-registries.mjs
// Run "npm run codegen" to regenerate.

import { service as diarizationMeta } from '../diarization/data'
import { service as embeddingsMeta } from '../embeddings/data'
import { service as faceRecognitionMeta } from '../face-recognition/data'
import { service as fileWatcherMeta } from '../file-watcher/data'
import { service as frameGenerationMeta } from '../frame-generation/data'
import { service as getiClassifierMeta } from '../geti-classifier/data'
import { service as imageBasedVideoSearchMeta } from '../suites/metro-ai-suite/image-based-video-search/data'
import { service as imageGenerationMeta } from '../image-generation/data'
import { service as lipsyncMeta } from '../lipsync/data'
import { service as lossPreventionMeta } from '../suites/retail-ai-suite/loss-prevention/data'
import { service as mcpMeta } from '../mcp/data'
import { service as medicalScribeDatabaseMeta } from '../medical-scribe-database/data'
import { service as ocrMeta } from '../ocr/data'
import { service as palletDefectDetectionMeta } from '../suites/manufacturing-ai-suite/pallet-defect-detection/data'
import { service as pptTranslatorMeta } from '../ppt-translator/data'
import { service as rerankMeta } from '../rerank/data'
import { service as roboticsAiMeta } from '../robotics-ai/data'
import { service as speechToTextMeta } from '../speech-to-text/data'
import { service as syntheticImageGenerationMeta } from '../synthetic-image-generation/data'
import { service as textGenerationMeta } from '../text-generation/data'
import { service as textToSpeechMeta } from '../text-to-speech/data'
import { service as vectordbMeta } from '../vectordb/data'
import { service as wakeWordDetectionMeta } from '../wake-word-detection/data'

/** Metadata-only map — safe to import in non-React/config contexts. */
export const metaMap = {
  diarization: diarizationMeta,
  embeddings: embeddingsMeta,
  'face-recognition': faceRecognitionMeta,
  'file-watcher': fileWatcherMeta,
  'frame-generation': frameGenerationMeta,
  'geti-classifier': getiClassifierMeta,
  'image-based-video-search': imageBasedVideoSearchMeta,
  'image-generation': imageGenerationMeta,
  lipsync: lipsyncMeta,
  'loss-prevention': lossPreventionMeta,
  mcp: mcpMeta,
  'medical-scribe-database': medicalScribeDatabaseMeta,
  ocr: ocrMeta,
  'pallet-defect-detection': palletDefectDetectionMeta,
  'ppt-translator': pptTranslatorMeta,
  rerank: rerankMeta,
  'robotics-ai': roboticsAiMeta,
  'speech-to-text': speechToTextMeta,
  'synthetic-image-generation': syntheticImageGenerationMeta,
  'text-generation': textGenerationMeta,
  'text-to-speech': textToSpeechMeta,
  vectordb: vectordbMeta,
  'wake-word-detection': wakeWordDetectionMeta,
}
