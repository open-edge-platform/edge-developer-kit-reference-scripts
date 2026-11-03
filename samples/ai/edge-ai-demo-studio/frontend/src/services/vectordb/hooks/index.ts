// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { requireApiBase } from '@/lib/browser/api-base'
import { fetchJson, fetchOk, postJson } from '@/lib/browser/fetch-json'
import { readSseJson, sseErrorMessage } from '@/lib/browser/sse'
import { getErrorMessage } from '@/lib/errors'
import type {
  ChunksResponse,
  EmbedFileProgress,
  FileEmbeddingsResult,
  KbFile,
  KnowledgeBase,
  SearchResult,
  VectorDbConfig,
} from '../types'

/** The name every vectordb call reports when the instance is not added. */
const SERVICE_NAME = 'Vector Database'

export const configKey = (apiBase: string | undefined) =>
  ['vectordb', 'config', apiBase] as const
const kbsKey = (apiBase: string | undefined) =>
  ['vectordb', 'kbs', apiBase] as const
const chunksKey = (apiBase: string | undefined, kbId?: number) =>
  ['vectordb', 'chunks', apiBase, kbId] as const
const filesKey = (apiBase: string | undefined, kbId?: number) =>
  ['vectordb', 'files', apiBase, kbId] as const

/** `GET /v1/config`: the worker's sibling services and storage backend. */
export function fetchVectorDbConfig(
  apiBase: string | undefined,
): Promise<VectorDbConfig> {
  requireApiBase(apiBase, SERVICE_NAME)
  return fetchJson(`${apiBase}/v1/config`)
}

/** Active embedding configuration and storage backend of the worker. */
export function useVectorDbConfig(apiBase: string | undefined) {
  return useQuery<VectorDbConfig>({
    queryKey: configKey(apiBase),
    enabled: Boolean(apiBase),
    queryFn: () => fetchVectorDbConfig(apiBase),
    // The worker may still be starting when the page mounts; keep polling
    // until it answers, then hold the value.
    refetchInterval: (query) => (query.state.data ? false : 5_000),
    retry: false,
  })
}

export function useConfigureEmbedding(apiBase: string | undefined) {
  return useMutation({
    mutationFn: (params: {
      embeddingUrl: string
      embeddingModel: string
      rerankerUrl?: string
      rerankerModel?: string
    }) => {
      requireApiBase(apiBase, SERVICE_NAME)
      return postJson<{ config: VectorDbConfig }>(`${apiBase}/v1/configure`, {
        embedding_url: params.embeddingUrl,
        embedding_model: params.embeddingModel,
        reranker_url: params.rerankerUrl ?? null,
        reranker_model: params.rerankerModel ?? null,
      })
    },
  })
}

export function useKnowledgeBases(apiBase: string | undefined) {
  return useQuery<KnowledgeBase[]>({
    queryKey: kbsKey(apiBase),
    enabled: Boolean(apiBase),
    queryFn: () => {
      requireApiBase(apiBase, SERVICE_NAME)
      return fetchJson(`${apiBase}/v1/kb`)
    },
  })
}

export function useCreateKb(apiBase: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => {
      requireApiBase(apiBase, SERVICE_NAME)
      return postJson<KnowledgeBase>(`${apiBase}/v1/kb`, { name })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: kbsKey(apiBase) })
    },
  })
}

export function useDeleteKb(apiBase: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => {
      requireApiBase(apiBase, SERVICE_NAME)
      return fetchJson(`${apiBase}/v1/kb/${id}`, { method: 'DELETE' })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: kbsKey(apiBase) })
    },
  })
}

function addChunk(apiBase: string | undefined, kbId: number, content: string) {
  requireApiBase(apiBase, SERVICE_NAME)
  return postJson(`${apiBase}/v1/kb/${kbId}/chunks`, { content })
}

function deleteChunks(
  apiBase: string | undefined,
  kbId: number,
  docIds: string[],
) {
  requireApiBase(apiBase, SERVICE_NAME)
  return postJson(
    `${apiBase}/v1/kb/${kbId}/chunks`,
    { doc_ids: docIds },
    { method: 'DELETE' },
  )
}

/** Points the worker at its Embeddings instance; runs inside the call so it is pending at once. */
type Prepare = () => Promise<void>

export function useAddChunk(apiBase: string | undefined, prepare?: Prepare) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: { kbId: number; content: string }) => {
      await prepare?.()
      return addChunk(apiBase, params.kbId, params.content)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: chunksKey(apiBase, variables.kbId),
      })
    },
  })
}

interface ReplaceChunkParams {
  kbId: number
  docId: string
  content: string
}

/**
 * Replaces a chunk's text. The worker has no update, so it adds the new chunk, then deletes the
 * old one: a failure never loses text, and saving the same text again only retries the delete.
 */
export function useReplaceChunk(
  apiBase: string | undefined,
  prepare?: Prepare,
) {
  const queryClient = useQueryClient()
  const [added, setAdded] = useState<ReplaceChunkParams | null>(null)
  return useMutation({
    mutationFn: async (params: ReplaceChunkParams) => {
      const alreadyAdded =
        added !== null &&
        added.kbId === params.kbId &&
        added.docId === params.docId &&
        added.content === params.content
      if (!alreadyAdded) {
        await prepare?.()
        await addChunk(apiBase, params.kbId, params.content)
        setAdded(params)
      }
      try {
        await deleteChunks(apiBase, params.kbId, [params.docId])
      } catch (error) {
        throw new Error(
          `The edited chunk was saved, but the old one could not be removed: ${getErrorMessage(error)}`,
        )
      }
      setAdded(null)
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: chunksKey(apiBase, variables.kbId),
      })
    },
  })
}

export function useKbChunks(apiBase: string | undefined, kbId?: number) {
  return useQuery<ChunksResponse>({
    queryKey: chunksKey(apiBase, kbId),
    enabled: Boolean(apiBase) && Boolean(kbId),
    queryFn: () => {
      requireApiBase(apiBase, SERVICE_NAME)
      return fetchJson(`${apiBase}/v1/kb/${kbId}/chunks`)
    },
  })
}

export function useDeleteChunks(apiBase: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { kbId: number; docIds: string[] }) =>
      deleteChunks(apiBase, params.kbId, params.docIds),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: chunksKey(apiBase, variables.kbId),
      })
    },
  })
}

export function useSearchKb(apiBase: string | undefined, prepare?: Prepare) {
  return useMutation({
    mutationFn: async (params: { kbId: number; query: string }) => {
      requireApiBase(apiBase, SERVICE_NAME)
      await prepare?.()
      return postJson<SearchResult[]>(
        `${apiBase}/v1/kb/${params.kbId}/search`,
        { query: params.query },
      )
    },
  })
}

export function useKbFiles(apiBase: string | undefined, kbId?: number) {
  return useQuery<KbFile[]>({
    queryKey: filesKey(apiBase, kbId),
    enabled: Boolean(apiBase) && Boolean(kbId),
    queryFn: () => {
      requireApiBase(apiBase, SERVICE_NAME)
      return fetchJson(`${apiBase}/v1/kb/${kbId}/files`)
    },
  })
}

export function useUploadFile(apiBase: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { kbId: number; file: File }) => {
      requireApiBase(apiBase, SERVICE_NAME)
      const formData = new FormData()
      formData.append('file', params.file)
      return fetchJson(`${apiBase}/v1/kb/${params.kbId}/files`, {
        method: 'POST',
        body: formData,
      })
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: filesKey(apiBase, variables.kbId),
      })
    },
  })
}

export function useDeleteFile(apiBase: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { kbId: number; filename: string }) => {
      requireApiBase(apiBase, SERVICE_NAME)
      return postJson(
        `${apiBase}/v1/kb/${params.kbId}/files`,
        { name: params.filename },
        { method: 'DELETE' },
      )
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: filesKey(apiBase, variables.kbId),
      })
    },
  })
}

/** A progress event of the embed stream, or `null` for one that carries none. */
function toEmbedProgress(
  event: string,
  data: Record<string, unknown>,
): EmbedFileProgress | null {
  const num = (key: string) => {
    const value = data[key]
    return typeof value === 'number' ? value : undefined
  }
  switch (event) {
    case 'queued':
      return { stage: 'queued', ahead: num('ahead') }
    case 'loading':
      return { stage: 'loading' }
    case 'splitting':
      return { stage: 'splitting', chunksDone: 0, chunksTotal: num('chunks') }
    case 'embedding':
      return {
        stage: 'embedding',
        chunksDone: num('done'),
        chunksTotal: num('total'),
        batch: num('batch'),
        batches: num('batches'),
      }
    case 'storing':
      return {
        stage: 'storing',
        chunksDone: num('chunks'),
        chunksTotal: num('chunks'),
      }
    default:
      return null
  }
}

/**
 * Embeds one uploaded file. Idempotent per file (its old chunks are dropped first), unlike the
 * bulk directory call, which duplicates. Progress streams to `onProgress`.
 */
export function useCreateFileEmbeddings(apiBase: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      kbId: number
      filename: string
      chunkSize?: number
      chunkOverlap?: number
      splitterName?: string
      onProgress?: (progress: EmbedFileProgress) => void
      /** Stops reading the stream; the worker may still finish the file. */
      signal?: AbortSignal
    }): Promise<FileEmbeddingsResult> => {
      requireApiBase(apiBase, SERVICE_NAME)
      const res = await fetchOk(`${apiBase}/v1/kb/${params.kbId}/files/embed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          filename: params.filename,
          chunk_size: params.chunkSize ?? 512,
          chunk_overlap: params.chunkOverlap ?? 200,
          splitter_name: params.splitterName ?? 'RecursiveCharacter',
        }),
        signal: params.signal,
      })
      // A worker without progress events answers with the JSON body.
      const contentType = res.headers.get('content-type') ?? ''
      if (!res.body || !contentType.includes('text/event-stream')) {
        return (await res.json()) as FileEmbeddingsResult
      }
      // The `done` event carries the result the JSON call answers with.
      for await (const { event, data } of readSseJson<
        FileEmbeddingsResult & Record<string, unknown>
      >(res.body)) {
        if (event === 'done') return data
        if (event === 'error') {
          throw new Error(
            sseErrorMessage(data, `Failed to embed ${params.filename}`),
          )
        }
        const progress = toEmbedProgress(event, data)
        if (progress) params.onProgress?.(progress)
      }
      throw new Error(`Embedding ${params.filename} stopped before it finished`)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: chunksKey(apiBase, variables.kbId),
      })
    },
  })
}
