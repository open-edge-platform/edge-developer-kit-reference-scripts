// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMemo } from 'react'
import { useFeaturePublish } from '@/context/feature-collector'
import { KnowledgeBasePanel } from './components/knowledge-base-panel'
import { useRagParams } from './hooks/use-rag-params'

/**
 * Headless feature provider for the optional RAG integration (embeddings +
 * vectordb + rerank). Auto-registered into `featureProviderRegistry` by codegen
 * and keyed by `vectordb` (its owning folder); a host sample mounts it via
 * `useFeatureProviders` to surface the RAG + Rerank config groups (with the
 * KnowledgeBasePanel embedded) and contribute `knowledgeBaseId` to the chat
 * request body. See docs/OPTIONAL-SERVICES.md.
 */
export function RagFeatureProvider() {
  const rag = useRagParams()
  const {
    groups: ragGroups,
    vectordbOnline,
    embeddingsOnline,
    selectedKb,
    onSelectKb,
    embeddingPort,
    embeddingModelName,
    rerankPort,
    rerankModelName,
    extraBody,
  } = rag

  // Embed the KnowledgeBasePanel as children of the vectordb group when both
  // embeddings and vectordb are online (mirrors the former use-rag-chat-setup).
  const groups = useMemo(
    () =>
      ragGroups.map((group) =>
        group.serviceId === 'vectordb' && vectordbOnline && embeddingsOnline
          ? {
              ...group,
              children: (
                <KnowledgeBasePanel
                  selectedKb={selectedKb}
                  onSelectKb={onSelectKb}
                  embeddingsOnline={embeddingsOnline}
                  embeddingPort={embeddingPort}
                  embeddingModelName={embeddingModelName}
                  rerankPort={rerankPort}
                  rerankModelName={rerankModelName}
                />
              ),
            }
          : group,
      ),
    [
      ragGroups,
      vectordbOnline,
      embeddingsOnline,
      selectedKb,
      onSelectKb,
      embeddingPort,
      embeddingModelName,
      rerankPort,
      rerankModelName,
    ],
  )

  useFeaturePublish('vectordb', { groups, extraBody })

  return null
}
