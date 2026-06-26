// THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY.
// Source of truth: scripts/generate-registries.mjs
// Run "npm run codegen" to regenerate.

import type { ServiceDocsData } from '../types'

export type DocsFactory = (opts: {
  host: string
  model?: string
}) => ServiceDocsData

import { getDocsData as diarizationDocs } from '../diarization/docs'
import { getDocsData as embeddingsDocs } from '../embeddings/docs'
import { getDocsData as imageGenerationDocs } from '../image-generation/docs'
import { getDocsData as lipsyncDocs } from '../lipsync/docs'
import { getDocsData as mcpDocs } from '../mcp/docs'
import { getDocsData as ocrDocs } from '../ocr/docs'
import { getDocsData as rerankDocs } from '../rerank/docs'
import { getDocsData as speechToTextDocs } from '../speech-to-text/docs'
import { getDocsData as textGenerationDocs } from '../text-generation/docs'
import { getDocsData as textToSpeechDocs } from '../text-to-speech/docs'
import { getDocsData as vectordbDocs } from '../vectordb/docs'
import { getDocsData as wakeWordDetectionDocs } from '../wake-word-detection/docs'

/** Registry of docs factory functions keyed by service ID. */
export const docsRegistry: Record<string, DocsFactory> = {
  diarization: diarizationDocs,
  embeddings: embeddingsDocs,
  'image-generation': imageGenerationDocs,
  lipsync: lipsyncDocs,
  mcp: mcpDocs,
  ocr: ocrDocs,
  rerank: rerankDocs,
  'speech-to-text': speechToTextDocs,
  'text-generation': textGenerationDocs,
  'text-to-speech': textToSpeechDocs,
  vectordb: vectordbDocs,
  'wake-word-detection': wakeWordDetectionDocs,
}
