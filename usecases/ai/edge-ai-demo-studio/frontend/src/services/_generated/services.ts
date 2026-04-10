// THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY.
// Source of truth: scripts/generate-registries.mjs
// Run "npm run codegen" to regenerate.

import type { Service as ServiceType } from '@/payload-types'

// Data imports (only for services that provide demos)
import { service as embeddingsMeta } from '../embeddings/data'
import { service as imageGenerationMeta } from '../image-generation/data'
import { service as lipsyncMeta } from '../lipsync/data'
import { service as mcpMeta } from '../mcp/data'
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
import { EmbeddingDemo } from '../embeddings/demo'
import { ImageGenerationDemo } from '../image-generation/demo'
import { LipsyncDemo } from '../lipsync/demo'
import { McpDemo } from '../mcp/demo'
import { PptTranslatorDemo } from '../ppt-translator/demo'
import { RerankerDemo } from '../rerank/demo'
import { RoboticsAIDemo } from '../robotics-ai/demo'
import { SpeechToTextDemo } from '../speech-to-text/demo'
import { SyntheticImageGenerationDemo } from '../synthetic-image-generation/demo'
import { TextGenerationDemo } from '../text-generation/demo'
import { TextToSpeechDemo } from '../text-to-speech/demo'
import { VectorDbDemo } from '../vectordb/demo'
import { WakeWordDetectionDemo } from '../wake-word-detection/demo'

import type { Service } from '../types'

/** Full service map including React demo components. */
export const serviceMap: Record<ServiceType['type'], Service> = {
  embeddings: {
    ...embeddingsMeta,
    status: 'offline',
    demo: EmbeddingDemo,
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
  mcp: {
    ...mcpMeta,
    status: 'offline',
    demo: McpDemo,
  },
  'ppt-translator': {
    ...pptTranslatorMeta,
    status: 'offline',
    demo: PptTranslatorDemo,
  },
  rerank: {
    ...rerankMeta,
    status: 'offline',
    demo: RerankerDemo,
  },
  'robotics-ai': {
    ...roboticsAiMeta,
    status: 'offline',
    demo: RoboticsAIDemo,
  },
  'speech-to-text': {
    ...speechToTextMeta,
    status: 'offline',
    demo: SpeechToTextDemo,
  },
  'synthetic-image-generation': {
    ...syntheticImageGenerationMeta,
    status: 'offline',
    demo: SyntheticImageGenerationDemo,
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
