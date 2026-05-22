// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMemo } from 'react'
import { KnowledgeBasePanel } from '../components/knowledge-base-panel'
import type { ServiceParamGroup } from '../components/demo-config-sheet'
import { useMcpParams } from './use-mcp-params'
import { useRagParams } from './use-rag-params'

/**
 * Combines RAG + MCP setup for chat-based samples. Returns:
 *
 * - `ragGroups` — RAG service param groups with the KnowledgeBasePanel
 *   embedded as children of the vectordb group (ready for DemoConfigSheet)
 * - `extraBody` — merged object for `useTextGenChat` containing both
 *   `knowledgeBaseId` (when a KB is selected) and `mcpServerIds`
 * - `mcp` — MCP hook return for its config group
 * - `rag` — full RAG hook return for direct access
 */
export function useRagChatSetup() {
  const rag = useRagParams()
  const mcp = useMcpParams()

  const ragGroups: ServiceParamGroup[] = useMemo(
    () =>
      rag.groups.map((group) =>
        group.serviceId === 'vectordb' &&
        rag.vectordbOnline &&
        rag.embeddingsOnline
          ? {
              ...group,
              children: (
                <KnowledgeBasePanel
                  selectedKb={rag.selectedKb}
                  onSelectKb={rag.onSelectKb}
                  embeddingsOnline={rag.embeddingsOnline}
                  embeddingPort={rag.embeddingPort}
                  embeddingModelName={rag.embeddingModelName}
                  rerankPort={rag.rerankPort}
                  rerankModelName={rag.rerankModelName}
                />
              ),
            }
          : group,
      ),
    [rag],
  )

  const extraBody = useMemo(
    () => ({
      ...rag.extraBody,
      ...(mcp.enabled && mcp.selectedServerIds.length > 0
        ? { mcpServerIds: mcp.selectedServerIds }
        : {}),
    }),
    [rag.extraBody, mcp.enabled, mcp.selectedServerIds],
  )

  return { rag, mcp, ragGroups, extraBody }
}
