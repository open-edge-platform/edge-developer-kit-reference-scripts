// THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY.
// Source of truth: scripts/generate-registries.mjs
// Run "npm run codegen" to regenerate.

import type { Service as ServiceType } from '@/payload-types'

// Data imports
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

// Demo imports
import { DiarizationDemo } from '../diarization/demo'
import { EmbeddingDemo } from '../embeddings/demo'
import { FaceRecognitionDemo } from '../face-recognition/demo'
import { FileWatcherDemo } from '../file-watcher/demo'
import { FrameGenerationDemo } from '../frame-generation/demo'
import { ImageGenerationDemo } from '../image-generation/demo'
import { LipsyncDemo } from '../lipsync/demo'
import { McpDemo } from '../mcp/demo'
import { OcrDemo } from '../ocr/demo'
import { RerankerDemo } from '../rerank/demo'
import { SpeechToTextDemo } from '../speech-to-text/demo'
import { TextGenerationDemo } from '../text-generation/demo'
import { TextToSpeechDemo } from '../text-to-speech/demo'
import { VectorDbDemo } from '../vectordb/demo'
import { WakeWordDetectionDemo } from '../wake-word-detection/demo'

import type { Service } from '../types'

/** Full service map including React demo components. */
export const serviceMap: Record<ServiceType['type'], Service> = {
  diarization: {
    ...diarizationMeta,
    status: 'offline',
    demo: DiarizationDemo,
  },
  embeddings: {
    ...embeddingsMeta,
    status: 'offline',
    demo: EmbeddingDemo,
  },
  'face-recognition': {
    ...faceRecognitionMeta,
    status: 'offline',
    demo: FaceRecognitionDemo,
  },
  'file-watcher': {
    ...fileWatcherMeta,
    status: 'offline',
    demo: FileWatcherDemo,
  },
  'frame-generation': {
    ...frameGenerationMeta,
    status: 'offline',
    demo: FrameGenerationDemo,
  },
  'geti-classifier': {
    ...getiClassifierMeta,
    status: 'offline',
  },
  'image-based-video-search': {
    ...imageBasedVideoSearchMeta,
    status: 'offline',
  },
  'image-generation': {
    ...imageGenerationMeta,
    status: 'offline',
    demo: ImageGenerationDemo,
  },
  lipsync: {
    ...lipsyncMeta,
    status: 'offline',
    demo: LipsyncDemo,
  },
  'loss-prevention': {
    ...lossPreventionMeta,
    status: 'offline',
  },
  mcp: {
    ...mcpMeta,
    status: 'offline',
    demo: McpDemo,
  },
  'medical-scribe-database': {
    ...medicalScribeDatabaseMeta,
    status: 'offline',
  },
  ocr: {
    ...ocrMeta,
    status: 'offline',
    demo: OcrDemo,
  },
  'pallet-defect-detection': {
    ...palletDefectDetectionMeta,
    status: 'offline',
  },
  'ppt-translator': {
    ...pptTranslatorMeta,
    status: 'offline',
  },
  rerank: {
    ...rerankMeta,
    status: 'offline',
    demo: RerankerDemo,
  },
  'robotics-ai': {
    ...roboticsAiMeta,
    status: 'offline',
  },
  'speech-to-text': {
    ...speechToTextMeta,
    status: 'offline',
    demo: SpeechToTextDemo,
  },
  'synthetic-image-generation': {
    ...syntheticImageGenerationMeta,
    status: 'offline',
  },
  'text-generation': {
    ...textGenerationMeta,
    status: 'offline',
    demo: TextGenerationDemo,
  },
  'text-to-speech': {
    ...textToSpeechMeta,
    status: 'offline',
    demo: TextToSpeechDemo,
  },
  vectordb: {
    ...vectordbMeta,
    status: 'offline',
    demo: VectorDbDemo,
  },
  'wake-word-detection': {
    ...wakeWordDetectionMeta,
    status: 'offline',
    demo: WakeWordDetectionDemo,
  },
}
