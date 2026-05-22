// THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY.
// Source of truth: scripts/generate-registries.mjs
// Run "npm run codegen" to regenerate.

import type { Sample } from '../types'

import { sample as aiExamMarking } from '../ai-exam-marking/data'
import { sample as digitalAvatar } from '../digital-avatar/data'
import { sample as digitalAvatarLite } from '../digital-avatar-lite/data'
import { sample as getiClassifier } from '../geti-classifier/data'
import { sample as medicalScribe } from '../medical-scribe/data'
import { sample as pptTranslator } from '../ppt-translator/data'
import { sample as ragChatbot } from '../rag-chatbot/data'
import { sample as roboticsAi } from '../robotics-ai/data'
import { sample as syntheticImageGeneration } from '../synthetic-image-generation/data'
import { sample as webcamVlm } from '../webcam-vlm/data'

/** Auto-discovered sample map. */
export const sampleMap: Record<string, Sample> = {
  'ai-exam-marking': aiExamMarking,
  'digital-avatar': digitalAvatar,
  'digital-avatar-lite': digitalAvatarLite,
  'geti-classifier': getiClassifier,
  'medical-scribe': medicalScribe,
  'ppt-translator': pptTranslator,
  'rag-chatbot': ragChatbot,
  'robotics-ai': roboticsAi,
  'synthetic-image-generation': syntheticImageGeneration,
  'webcam-vlm': webcamVlm,
}
