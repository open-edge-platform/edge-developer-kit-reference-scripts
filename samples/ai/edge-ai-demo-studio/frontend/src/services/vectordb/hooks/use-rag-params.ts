// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMemo, useState } from 'react'
import { useBoundInstanceKey } from '@/context/sample-instances-context'
import {
  useGetServices,
  useServiceInstances,
} from '@/context/service-status-context'
import type { ServiceParamGroup } from '@/types/demo-params'
import type { KnowledgeBase } from '../types'
import { useVectorDbConfig } from './index'
import { configuredInstanceKey } from './use-vectordb-dependencies'
import { useVectorDbSiblings } from './use-vectordb-siblings'

interface UseRagParamsOptions {
  rerankOptional?: boolean
}

export function useRagParams(options?: UseRagParamsOptions) {
  const { rerankOptional = true } = options ?? {}

  const [selectedKb, setSelectedKb] = useState<KnowledgeBase | null>(null)
  const [rerankEnabled, setRerankEnabled] = useState(true)

  const { vectordb: vectordbService } = useGetServices(['vectordb'])
  const vectordbOnline = vectordbService?.status === 'online'
  const vectordbApiBase = vectordbService?.apiBase
  const workerConfig = useVectorDbConfig(
    vectordbOnline ? vectordbApiBase : undefined,
  ).data

  // Embeddings: the sample's binding, else the one the worker already embeds with (its knowledge
  // bases were built with it), else the type's own.
  const embeddingInstances = useServiceInstances('embeddings')
  const embeddingsKey =
    useBoundInstanceKey('embeddings') ??
    configuredInstanceKey(embeddingInstances, workerConfig?.embedding_url)
  const siblings = useVectorDbSiblings({
    rerank: rerankOptional ? rerankEnabled : true,
    embeddings: embeddingsKey,
  })
  const {
    embeddingsOnline,
    rerankOnline: rerankServiceOnline,
    embeddingUrl,
    embeddingModelName,
    rerankUrl,
    rerankModelName,
  } = siblings

  // Memoized so the vectordb feature provider can publish these groups without re-render churn.
  const ragGroup: ServiceParamGroup = useMemo(
    () => ({
      serviceLabel: 'RAG',
      serviceId: 'vectordb',
      instanceTypes: ['vectordb', 'embeddings'],
      online: vectordbOnline && embeddingsOnline,
      optional: true,
      offlineMessage:
        'Start the Embeddings and VectorDB services to enable document-based knowledge retrieval.',
      params: [],
      enabled: true,
    }),
    [vectordbOnline, embeddingsOnline],
  )

  const rerankGroup: ServiceParamGroup = useMemo(
    () => ({
      serviceLabel: 'Rerank',
      serviceId: 'rerank',
      online: rerankServiceOnline,
      optional: rerankOptional,
      offlineMessage: 'Enable reranking to improve search result relevance.',
      params: [],
      ...(rerankOptional
        ? {
            enabled: rerankEnabled,
            onToggle: setRerankEnabled,
          }
        : {}),
    }),
    [rerankServiceOnline, rerankOptional, rerankEnabled],
  )

  const groups = useMemo(() => [ragGroup, rerankGroup], [ragGroup, rerankGroup])

  // The chat route re-applies these services before searching (the worker keeps whichever it was
  // last given), but only once the worker's config, which the choice may follow, is known.
  const workerConfigKnown = workerConfig !== undefined
  const extraBody = useMemo(() => {
    if (selectedKb?.id == null) return {}
    return {
      knowledgeBaseId: selectedKb.id,
      ...(workerConfigKnown && embeddingUrl && embeddingModelName
        ? {
            vectordbConfig: {
              embeddingUrl,
              embeddingModel: embeddingModelName,
              rerankerUrl: rerankUrl,
              rerankerModel: rerankModelName,
            },
          }
        : {}),
    }
  }, [
    selectedKb,
    workerConfigKnown,
    embeddingUrl,
    embeddingModelName,
    rerankUrl,
    rerankModelName,
  ])

  return {
    selectedKb,
    onSelectKb: setSelectedKb,
    extraBody,
    embeddingsOnline,
    vectordbOnline,
    vectordbApiBase,
    siblings,
    groups,
  }
}
