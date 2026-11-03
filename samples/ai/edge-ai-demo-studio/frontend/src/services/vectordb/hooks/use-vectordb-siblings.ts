// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useGetService } from '@/context/service-status-context'
import { requireApiBase } from '@/lib/browser/api-base'
import { siblingWorkerAddress } from '@/lib/instances/instances'
import { getServiceModelName } from '@/services/common/get-service-model'
import type { VectorDbConfig } from '../types'
import { configKey, fetchVectorDbConfig, useConfigureEmbedding } from './index'

/**
 * The services a vectordb worker calls: Embeddings (to add text or search) and optionally Rerank,
 * each by the address it reaches through the app and the model name it sends.
 */
export interface VectorDbSiblings {
  /** The Embeddings instance the worker embeds with, when there is one. */
  embeddingsKey?: string
  /** Its name, for messages ("Start GPU embeddings first"). */
  embeddingsLabel?: string
  embeddingsOnline: boolean
  /** Set while Embeddings is online. */
  embeddingUrl?: string
  embeddingModelName?: string
  /** The Rerank instance the worker ranks with, when one is wanted. */
  rerankKey?: string
  rerankOnline: boolean
  /** Set while Rerank is online and wanted. */
  rerankUrl?: string
  rerankModelName?: string
}

/** The instance key in a sibling address (`/api/<type>@<id>/v1`), else `undefined`. */
export function instanceKeyOfSiblingAddress(
  address: string | null | undefined,
): string | undefined {
  return /^\/api\/([a-z0-9-]+@[a-z0-9_-]+)\/v1$/.exec(address ?? '')?.[1]
}

/**
 * Resolves the worker's siblings: each type's primary instance (running, else first) unless
 * `embeddings` / `reranker` name one (`type@id`); `rerank: false` leaves the reranker out.
 */
export function useVectorDbSiblings({
  rerank = true,
  embeddings: embeddingsTarget = 'embeddings',
  reranker: rerankTarget = 'rerank',
}: {
  rerank?: boolean
  /** An Embeddings instance key, or the type for its primary instance. */
  embeddings?: string
  /** A Rerank instance key, or the type for its primary instance. */
  reranker?: string
} = {}): VectorDbSiblings {
  const embeddings = useGetService(embeddingsTarget)
  const rerankService = useGetService(rerankTarget)
  const embeddingsKey = embeddings?.instanceKey
  const embeddingsLabel = embeddings?.label
  const rerankKey = rerank ? rerankService?.instanceKey : undefined

  const embeddingsOnline = embeddings?.status === 'online'
  const embeddingUrl =
    embeddingsOnline && embeddings.instanceKey
      ? siblingWorkerAddress(embeddings.instanceKey)
      : undefined
  // Engine-aware: multiserve qualifies the name with its backend, the OEP
  // multimodal worker takes the upstream model id as stored.
  const embeddingModelName =
    embeddingUrl && embeddings
      ? getServiceModelName(embeddings, true)
      : undefined

  const rerankOnline = rerankService?.status === 'online'
  const rerankUrl =
    rerank && rerankOnline && rerankService.instanceKey
      ? siblingWorkerAddress(rerankService.instanceKey)
      : undefined
  const rerankModelName =
    rerankUrl && rerankService
      ? getServiceModelName(rerankService, true)
      : undefined

  // Stable identity: the RAG feature provider publishes this from an effect, which would otherwise
  // publish (and re-render its host) on every render.
  return useMemo(
    () => ({
      embeddingsKey,
      embeddingsLabel,
      embeddingsOnline,
      embeddingUrl,
      embeddingModelName,
      rerankKey,
      rerankOnline,
      rerankUrl,
      rerankModelName,
    }),
    [
      embeddingsKey,
      embeddingsLabel,
      embeddingsOnline,
      embeddingUrl,
      embeddingModelName,
      rerankKey,
      rerankOnline,
      rerankUrl,
      rerankModelName,
    ],
  )
}

function configuredFor(
  config: VectorDbConfig,
  siblings: VectorDbSiblings,
): boolean {
  return (
    config.embedding_url === siblings.embeddingUrl &&
    config.embedding_model === siblings.embeddingModelName &&
    (config.reranker_url ?? undefined) === siblings.rerankUrl &&
    (config.reranker_model ?? undefined) === siblings.rerankModelName
  )
}

/** Whether the worker's config already has the addresses and models `siblings` describe. */
export function workerUsesSiblings(
  config: VectorDbConfig | undefined,
  siblings: VectorDbSiblings,
): boolean {
  return config !== undefined && configuredFor(config, siblings)
}

/**
 * Call the returned function before work that needs the siblings: it reads the worker's config (a
 * restarted worker forgets) and reconfigures it only when that differs from the chosen instances.
 */
export function useEnsureVectorDbConfigured(
  apiBase: string | undefined,
  siblings: VectorDbSiblings,
) {
  const queryClient = useQueryClient()
  const { mutateAsync: configure } = useConfigureEmbedding(apiBase)

  return async () => {
    requireApiBase(apiBase, 'Vector Database')
    const { embeddingUrl, embeddingModelName, rerankUrl, rerankModelName } =
      siblings
    if (!embeddingUrl || !embeddingModelName) {
      throw new Error(
        `Start ${siblings.embeddingsLabel ?? 'the Embeddings service'} first`,
      )
    }
    const current = await queryClient.fetchQuery({
      queryKey: configKey(apiBase),
      queryFn: () => fetchVectorDbConfig(apiBase),
      staleTime: 0,
    })
    if (configuredFor(current, siblings)) return
    const { config } = await configure({
      embeddingUrl,
      embeddingModel: embeddingModelName,
      rerankerUrl: rerankUrl,
      rerankerModel: rerankModelName,
    })
    queryClient.setQueryData(configKey(apiBase), config)
  }
}
