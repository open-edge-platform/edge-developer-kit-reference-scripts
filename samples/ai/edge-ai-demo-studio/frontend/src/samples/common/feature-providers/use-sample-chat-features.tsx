// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { ReactNode } from 'react'
import {
  FeatureCollectorProvider,
  type FeatureExports,
  useFeatureCollector,
} from '@/context/feature-collector'
import {
  type FeatureProviderComponent,
  featureProviderRegistry,
} from '@/services/_generated/feature-providers'
import type { ServiceParamGroup } from '@/types/demo-params'
import { getOptionalDeps, type Sample } from '../../types'

/** Parameters-sheet order of the providers' groups; the RAG provider (`vectordb`) adds `rerank`. */
const CHAT_FEATURE_ORDER = [
  'text-to-speech',
  'speech-to-text',
  'wake-word-detection',
  'vectordb',
  'rerank',
  'mcp',
]

const orderOf = (serviceId: string) => {
  const index = CHAT_FEATURE_ORDER.indexOf(serviceId)
  return index === -1 ? CHAT_FEATURE_ORDER.length : index
}

/**
 * A feature provider for each dependency the sample declares `optional`, in Parameters-sheet order.
 * Required services are never mounted here; the demo uses them directly.
 */
function chatFeatureProviders(
  sample: Sample,
): { serviceId: string; Provider: FeatureProviderComponent }[] {
  return getOptionalDeps(sample)
    .flatMap(({ serviceId }) => {
      const Provider = featureProviderRegistry[serviceId]
      return Provider ? [{ serviceId, Provider }] : []
    })
    .sort((a, b) => orderOf(a.serviceId) - orderOf(b.serviceId))
}

export interface SampleChatFeatures {
  /**
   * The feature providers; render once. Takes `onTranscription` (the chat's `setInput`) at render
   * time because the chat needs this hook's `extraBody` first.
   */
  renderProviders: (onTranscription?: (text: string) => void) => ReactNode
  /** Parameters-sheet groups the providers publish, in sheet order. */
  groups: ServiceParamGroup[]
  /** One published group, to place it among a sample's own groups. */
  group: (serviceId: string) => ServiceParamGroup | undefined
  /** Fields for the chat request body (e.g. `mcpServerIds`, `knowledgeBaseId`). */
  extraBody: Record<string, unknown>
  /** For `FeatureContexts`, which gives the chat its mic and speak controls. */
  exports: FeatureExports
  sttOnline: boolean
  ttsOnline: boolean
}

/**
 * Optional-service wiring for a chat sample: pass `extraBody` to the chat, call `renderProviders`,
 * add `groups` to the Parameters sheet and wrap the chat in `FeatureContexts`.
 */
export function useSampleChatFeatures(sample: Sample): SampleChatFeatures {
  const providers = chatFeatureProviders(sample)
  const collector = useFeatureCollector(CHAT_FEATURE_ORDER)
  const { registry, groups, extraBody, exports } = collector

  return {
    renderProviders: (onTranscription) => (
      <FeatureCollectorProvider value={registry}>
        {providers.map(({ serviceId, Provider }) => (
          <Provider
            key={serviceId}
            onTranscription={onTranscription}
            sampleId={sample.id}
          />
        ))}
      </FeatureCollectorProvider>
    ),
    groups,
    group: (serviceId) => groups.find((g) => g.serviceId === serviceId),
    extraBody,
    exports,
    sttOnline: exports.sttOnline ?? false,
    ttsOnline: exports.ttsOnline ?? false,
  }
}
