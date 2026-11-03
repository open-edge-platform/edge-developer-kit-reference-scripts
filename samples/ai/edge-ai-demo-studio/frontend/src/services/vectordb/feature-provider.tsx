// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMemo } from 'react'
import { useFeaturePublish } from '@/context/feature-collector'
import { KnowledgeBasePanel } from './components/knowledge-base-panel'
import { useRagParams } from './hooks/use-rag-params'

/**
 * Headless RAG feature (embeddings + vectordb + rerank), registered by codegen under `vectordb`:
 * adds the RAG and Rerank config groups and `knowledgeBaseId` to a sample's chat request.
 */
export function RagFeatureProvider() {
  const rag = useRagParams()
  const {
    groups: ragGroups,
    vectordbOnline,
    vectordbApiBase,
    embeddingsOnline,
    selectedKb,
    onSelectKb,
    siblings,
    extraBody,
  } = rag

  // Memoized: `useFeaturePublish` publishes from an effect, so a new identity every render
  // would re-publish (and re-render the host) in a loop.
  const groups = useMemo(
    () =>
      ragGroups.map((group) =>
        group.serviceId === 'vectordb' && vectordbOnline && embeddingsOnline
          ? {
              ...group,
              children: (
                <KnowledgeBasePanel
                  apiBase={vectordbApiBase}
                  selectedKb={selectedKb}
                  onSelectKb={onSelectKb}
                  siblings={siblings}
                />
              ),
            }
          : group,
      ),
    [
      ragGroups,
      vectordbOnline,
      vectordbApiBase,
      embeddingsOnline,
      selectedKb,
      onSelectKb,
      siblings,
    ],
  )

  useFeaturePublish('vectordb', { groups, extraBody })

  return null
}
