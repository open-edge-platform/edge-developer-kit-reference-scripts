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
    mutationFn: async ({ kbId, query }: SearchKBProps) => {
      const response = await EMBEDDINGS_API.get(
        `kb/${kbId}/search?q=${encodeURIComponent(query)}`,
      )
      return response
    },
  })
}
