// THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY.
// Source of truth: scripts/generate-registries.mjs
// Run "npm run codegen" to regenerate.

import type { ComponentType } from 'react'

import { McpFeatureProvider } from '../mcp/feature-provider'
import { SttFeatureProvider } from '../speech-to-text/feature-provider'
import { TtsFeatureProvider } from '../text-to-speech/feature-provider'
import { RagFeatureProvider } from '../vectordb/feature-provider'
import { WakeWordFeatureProvider } from '../wake-word-detection/feature-provider'

/** Props every optional-service feature provider component accepts. */
export interface FeatureProviderProps {
  /** Called by speech-driven providers (STT) with recognized text. */
  onTranscription?: (text: string) => void
  /** Host sample id (e.g. for service-specific config links). */
  sampleId?: string
}

export type FeatureProviderComponent = ComponentType<FeatureProviderProps>

/** Optional-service feature provider keyed by service ID. Looked up by
 *  `useFeatureProviders`; a pruned service folder drops out automatically. */
export const featureProviderRegistry: Partial<
  Record<string, FeatureProviderComponent>
> = {
  mcp: McpFeatureProvider,
  'speech-to-text': SttFeatureProvider,
  'text-to-speech': TtsFeatureProvider,
  vectordb: RagFeatureProvider,
  'wake-word-detection': WakeWordFeatureProvider,
}
