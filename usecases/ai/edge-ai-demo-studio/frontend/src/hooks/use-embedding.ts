// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { FetchAPI } from '@/lib/api'
import {
  CreateKBProps,
  CreateTextEmbeddingProps,
  KnowledgeBase,
  SearchKBProps,
  UploadFileProps,
} from '@/types/embedding'
import { useMutation, useQuery } from '@tanstack/react-query'

const EMBEDDINGS_API = new FetchAPI(`/api/embeddings`, 'v1')

export const useCreateTextEmbedding = () => {
  return useMutation({
    mutationFn: async (params: CreateTextEmbeddingProps) => {
      const response = await EMBEDDINGS_API.post('embeddings', params)
      return response
    },
  })
}

export const useRerank = () => {
  return useMutation({
    mutationFn: async (params: {
      model: string
      query: string
      documents: string[]
      top_n?: number
      return_documents?: boolean
    }) => {
      const response = await EMBEDDINGS_API.post('rerank', params)
      return response
    },
  })
}

export const useGetKnowledgeBases = ({ disabled }: { disabled: boolean }) => {
  return useQuery({
    queryKey: ['knowledge-bases'],
    queryFn: async () => {
      const response = await EMBEDDINGS_API.get('kb')
      return response as KnowledgeBase[]
    },
    enabled: !disabled,
  })
}

export const useGetKnowledgeBase = (id: number) => {
  return useQuery({
    queryKey: ['knowledge-base', id],
    queryFn: async () => {
      const response = await EMBEDDINGS_API.get(`kb/${id}`)
      return response
    },
    enabled: !!id,
  })
}

export const useCreateKnowledgeBase = () => {
  return useMutation({
    mutationFn: async (params: CreateKBProps) => {
      const response = await EMBEDDINGS_API.post('kb', params)
      return response
    },
  })
}

export const useDeleteKnowledgeBase = () => {
  return useMutation({
    mutationFn: async ({ id }: { id: number }) => {
      const response = await EMBEDDINGS_API.delete(`kb/${id}`)
      return response
    },
  })
}

export const useGetKnowledgeBaseFiles = (id: number) => {
  return useQuery({
    queryKey: ['knowledge-base-files', id],
    queryFn: async () => {
      const response = await EMBEDDINGS_API.get(`kb/${id}/files`)
      return response
    },
    enabled: !!id,
  })
}

export const useUploadKnowledgeBaseFile = () => {
  return useMutation({
    mutationFn: async ({ kbId, file }: UploadFileProps) => {
      const formData = new FormData()
      formData.append('file', file)

      const response = await EMBEDDINGS_API.post(`kb/${kbId}/files`, formData, {
        headers: {},
      })
      return response
    },
  })
}

export const useDeleteKnowledgeBaseFile = () => {
  return useMutation({
    mutationFn: async ({
      kbId,
      fileName,
    }: {
      kbId: number
      fileName: string
    }) => {
      const response = await EMBEDDINGS_API.delete(`kb/${kbId}/files`, {
        data: { name: fileName },
      })
      return response
    },
  })
}

export const useCreateKnowledgeBaseEmbeddings = () => {
  return useMutation({
    mutationFn: async ({ kbId }: { kbId: number }) => {
      const response = await EMBEDDINGS_API.post(`kb/${kbId}/create`)
      return response
    },
  })
}

export const useSearchKnowledgeBase = () => {
  return useMutation({
    mutationFn: async ({
      kbId,
      query,
      searchType = 'similarity',
      topK = 4,
      topN = 3,
      scoreThreshold,
      fetchK = 20,
      lambdaMult = 0.5,
    }: SearchKBProps & {
      searchType?: string
      topK?: number
      topN?: number
      scoreThreshold?: number
      fetchK?: number
      lambdaMult?: number
    }) => {
      const searchParams = {
        query,
        search_type: searchType,
        top_k: topK,
        top_n: topN,
        ...(scoreThreshold !== undefined && {
          score_threshold: scoreThreshold,
        }),
        ...(searchType === 'mmr' && {
          fetch_k: fetchK,
          lambda_mult: lambdaMult,
        }),
      }

      const response = await EMBEDDINGS_API.post(
        `kb/${kbId}/search`,
        searchParams,
      )
      return response
    },
  })
}

export const useCreateKnowledgeBaseEmbeddingsAdvanced = () => {
  return useMutation({
    mutationFn: async ({
      kbId,
      splitterName = 'RecursiveCharacter',
      chunkSize = 1000,
      chunkOverlap = 200,
    }: {
      kbId: number
      splitterName?: string
      chunkSize?: number
      chunkOverlap?: number
    }) => {
      const response = await EMBEDDINGS_API.post(`kb/${kbId}/create`, {
        splitter_name: splitterName,
        chunk_size: chunkSize,
        chunk_overlap: chunkOverlap,
      })
      return response
    },
  })
}

export const useGetKnowledgeBaseChunks = (
  kbId: number,
  includeEmbeddings: boolean = false,
) => {
  return useQuery({
    queryKey: ['knowledge-base-chunks', kbId, includeEmbeddings],
    queryFn: async () => {
      const params = includeEmbeddings ? '?include_embeddings=true' : ''
      const response = await EMBEDDINGS_API.get(`kb/${kbId}/chunks${params}`)
      return response
    },
    enabled: !!kbId,
  })
}

export const useAddChunkToKnowledgeBase = () => {
  return useMutation({
    mutationFn: async ({
      kbId,
      content,
      metadata,
    }: {
      kbId: number
      content: string
      metadata?: Record<string, unknown>
    }) => {
      const response = await EMBEDDINGS_API.post(`kb/${kbId}/chunks`, {
        content,
        metadata,
      })
      return response
    },
  })
}

export const useDeleteChunksFromKnowledgeBase = () => {
  return useMutation({
    mutationFn: async ({
      kbId,
      docIds,
    }: {
      kbId: number
      docIds: string[]
    }) => {
      const response = await EMBEDDINGS_API.delete(`kb/${kbId}/chunks`, {
        data: {
          doc_ids: docIds,
        },
      })
      return response
    },
  })
}
