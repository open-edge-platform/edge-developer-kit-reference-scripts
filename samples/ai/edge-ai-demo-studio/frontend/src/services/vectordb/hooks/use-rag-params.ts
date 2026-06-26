// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMemo, useState } from 'react'
import { useGetServices } from '@/context/service-status-context'
import { engines } from '@/engines/registry'
import type { ServiceParamGroup } from '@/types/demo-params'
import type { KnowledgeBase } from '../types'

interface UseRagParamsOptions {
  rerankOptional?: boolean
}

export function useRagParams(options?: UseRagParamsOptions) {
  const { rerankOptional = true } = options ?? {}

  const [selectedKb, setSelectedKb] = useState<KnowledgeBase | null>(null)
  const [rerankEnabled, setRerankEnabled] = useState(true)

  const {
    embeddings: embeddingsService,
    vectordb: vectordbService,
    rerank: rerankService,
  } = useGetServices(['embeddings', 'vectordb', 'rerank'])

  const embeddingsOnline = embeddingsService?.status === 'online'
  const vectordbOnline = vectordbService?.status === 'online'

  const embeddingPort = embeddingsService?.port
  const embeddingEngine = embeddingsService?.engine ?? 'multiserve'
  const embeddingModelConfig = {
    name:
      embeddingsService?.currentModel ??
      embeddingsService?.defaultModel?.name ??
      '',
    device:
      embeddingsService?.currentDevice ??
      embeddingsService?.defaultModel?.device ??
      '',
    backend:
      embeddingsService?.currentBackend ??
      embeddingsService?.defaultModel?.backend,
    quant: embeddingsService?.defaultModel?.quant,
  }
  const embeddingModelName =
    embeddingsOnline && embeddingPort
      ? engines[embeddingEngine].getModelName(embeddingModelConfig, true)
      : undefined

  const rerankOnline =
    rerankService?.status === 'online' &&
    (rerankOptional ? rerankEnabled : true)
  const rerankPort = rerankOnline ? rerankService?.port : undefined
  const rerankEngine = rerankService?.engine ?? 'multiserve'
  const rerankModelConfig = {
    name:
      rerankService?.currentModel ?? rerankService?.defaultModel?.name ?? '',
    device:
      rerankService?.currentDevice ?? rerankService?.defaultModel?.device ?? '',
    backend:
      rerankService?.currentBackend ?? rerankService?.defaultModel?.backend,
    quant: rerankService?.defaultModel?.quant,
  }
  const rerankModelName =
    rerankOnline && rerankPort
      ? engines[rerankEngine].getModelName(rerankModelConfig, true)
      : undefined

  const rerankServiceOnline = rerankService?.status === 'online'

  // Memoized so the vectordb feature provider can publish these groups through
  // the collector without re-render churn (see docs/OPTIONAL-SERVICES.md).
  const ragGroup: ServiceParamGroup = useMemo(
    () => ({
      serviceLabel: 'RAG',
      serviceId: 'vectordb',
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

  const extraBody = useMemo(
    () => (selectedKb?.id != null ? { knowledgeBaseId: selectedKb.id } : {}),
    [selectedKb],
  )

  return {
    selectedKb,
    onSelectKb: setSelectedKb,
    extraBody,
    embeddingsOnline,
    vectordbOnline,
    embeddingPort,
    embeddingModelName,
    rerankPort,
    rerankModelName,
    groups,
  }
}
