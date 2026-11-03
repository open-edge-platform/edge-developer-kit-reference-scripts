// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useServiceInstances } from '@/context/service-status-context'
import { demoStateKey } from '@/services/common/demo/demo-session'
import { useSessionState } from '@/services/common/demo/session-store'
import type { Service, ServiceInstance } from '@/services/types'
import type { VectorDbConfig } from '../types'
import {
  instanceKeyOfSiblingAddress,
  useVectorDbSiblings,
} from './use-vectordb-siblings'

/** The reranker choice that leaves reranking out. */
export const NO_RERANKER = 'none'

/** The running instance, else the first — what a type resolves to. */
function primaryOf(instances: ServiceInstance[]) {
  return instances.find((i) => i.status === 'online') ?? instances[0]
}

/** The instance among `instances` the worker was pointed at, if any. */
export function configuredInstanceKey(
  instances: ServiceInstance[],
  address: string | null | undefined,
) {
  const key = instanceKeyOfSiblingAddress(address)
  return instances.find((i) => i.instanceKey === key)?.instanceKey
}

/**
 * The Embeddings and optional Rerank instances a Vector Database works with. Until the user picks
 * one (kept per instance for the visit), each follows the worker's current config, else the type's
 * running instance; a worker configured without a reranker stays without one.
 */
export function useVectorDbDependencies(
  service: Service,
  workerConfig: VectorDbConfig | undefined,
) {
  const embeddingInstances = useServiceInstances('embeddings')
  const rerankInstances = useServiceInstances('rerank')
  const [embeddingsChoice, setEmbeddingsChoice] = useSessionState<
    string | null
  >(demoStateKey(service, 'vectordb:embeddings'), null)
  const [rerankChoice, setRerankChoice] = useSessionState<string | null>(
    demoStateKey(service, 'vectordb:reranker'),
    null,
  )

  const embeddingsKey =
    (embeddingsChoice &&
      embeddingInstances.find((i) => i.instanceKey === embeddingsChoice)
        ?.instanceKey) ??
    configuredInstanceKey(embeddingInstances, workerConfig?.embedding_url) ??
    primaryOf(embeddingInstances)?.instanceKey

  const rerankKey = (() => {
    if (rerankChoice === NO_RERANKER) return undefined
    const chosen = rerankInstances.find((i) => i.instanceKey === rerankChoice)
    if (chosen) return chosen.instanceKey
    // A configured worker's reranker (or its lack of one) stands.
    if (workerConfig?.embedding_url) {
      return configuredInstanceKey(rerankInstances, workerConfig.reranker_url)
    }
    const running = rerankInstances.find((i) => i.status === 'online')
    return running?.instanceKey
  })()

  const siblings = useVectorDbSiblings({
    embeddings: embeddingsKey ?? 'embeddings',
    reranker: rerankKey ?? 'rerank',
    rerank: rerankKey !== undefined,
  })

  return {
    siblings,
    embeddingInstances,
    rerankInstances,
    embeddingsKey,
    /** The chosen reranker's key, or {@link NO_RERANKER}. */
    rerankChoice: rerankKey ?? NO_RERANKER,
    chooseEmbeddings: setEmbeddingsChoice,
    chooseReranker: setRerankChoice,
  }
}

export type VectorDbDependencies = ReturnType<typeof useVectorDbDependencies>
