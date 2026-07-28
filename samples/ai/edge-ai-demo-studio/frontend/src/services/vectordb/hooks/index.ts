import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChunksResponse, KnowledgeBase, SearchResult } from '../types'

const API_BASE = '/api/vectordb/v1'

export function useConfigureEmbedding() {
  return useMutation({
    mutationFn: async (params: {
      embeddingUrl: string
      embeddingModel: string
      rerankerUrl?: string
      rerankerModel?: string
    }) => {
      const url = new URL(`${API_BASE}/configure`, window.location.origin)
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embedding_url: params.embeddingUrl,
          embedding_model: params.embeddingModel,
          reranker_url: params.rerankerUrl ?? null,
          reranker_model: params.rerankerModel ?? null,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  })
}

export function useKnowledgeBases() {
  return useQuery<KnowledgeBase[]>({
    queryKey: ['vectordb', 'kbs'],
    queryFn: async () => {
      const url = new URL(`${API_BASE}/kb`, window.location.origin)
      const res = await fetch(url)
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  })
}

export function useCreateKb() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => {
      const url = new URL(`${API_BASE}/kb`, window.location.origin)
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json() as Promise<KnowledgeBase>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vectordb', 'kbs'] })
    },
  })
}

export function useDeleteKb() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const url = new URL(`${API_BASE}/kb/${id}`, window.location.origin)
      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vectordb', 'kbs'] })
    },
  })
}

export function useAddChunk() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: { kbId: number; content: string }) => {
      const url = new URL(
        `${API_BASE}/kb/${params.kbId}/chunks`,
        window.location.origin,
      )
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: params.content }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['vectordb', 'chunks', variables.kbId],
      })
    },
  })
}

export function useKbChunks(kbId?: number) {
  return useQuery<ChunksResponse>({
    queryKey: ['vectordb', 'chunks', kbId],
    enabled: Boolean(kbId),
    queryFn: async () => {
      const url = new URL(
        `${API_BASE}/kb/${kbId}/chunks`,
        window.location.origin,
      )
      const res = await fetch(url)
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  })
}

export function useDeleteChunk() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: { kbId: number; docId: string }) => {
      const url = new URL(
        `${API_BASE}/kb/${params.kbId}/chunks`,
        window.location.origin,
      )
      const res = await fetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_ids: [params.docId] }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['vectordb', 'chunks', variables.kbId],
      })
    },
  })
}

/** Delete multiple chunks at once by their document IDs. */
export function useDeleteChunksByIds() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: { kbId: number; docIds: string[] }) => {
      const url = new URL(
        `${API_BASE}/kb/${params.kbId}/chunks`,
        window.location.origin,
      )
      const res = await fetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_ids: params.docIds }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['vectordb', 'chunks', variables.kbId],
      })
    },
  })
}

export function useSearchKb() {
  return useMutation({
    mutationFn: async (params: {
      kbId: number
      query: string
    }): Promise<SearchResult[]> => {
      const url = new URL(
        `${API_BASE}/kb/${params.kbId}/search`,
        window.location.origin,
      )
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: params.query }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  })
}

export interface KbFile {
  id: number
  name: string
  ext: string
}

export function useKbFiles(kbId?: number) {
  return useQuery<KbFile[]>({
    queryKey: ['vectordb', 'files', kbId],
    enabled: Boolean(kbId),
    queryFn: async () => {
      const url = new URL(
        `${API_BASE}/kb/${kbId}/files`,
        window.location.origin,
      )
      const res = await fetch(url)
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  })
}

export function useUploadFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: { kbId: number; file: File }) => {
      const formData = new FormData()
      formData.append('file', params.file)
      const url = new URL(
        `${API_BASE}/kb/${params.kbId}/files`,
        window.location.origin,
      )
      const res = await fetch(url, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['vectordb', 'files', variables.kbId],
      })
    },
  })
}

export function useDeleteFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: { kbId: number; filename: string }) => {
      const url = new URL(
        `${API_BASE}/kb/${params.kbId}/files`,
        window.location.origin,
      )
      const res = await fetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: params.filename }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['vectordb', 'files', variables.kbId],
      })
    },
  })
}

/**
 * Embed a single already-uploaded file. This endpoint is idempotent per source:
 * it first removes any existing chunks whose source is this file, then re-embeds
 * it — so embedding a file that was already embedded won't create duplicates.
 * Prefer this over a bulk "embed the whole directory" call, which re-embeds
 * (and thus duplicates) files that were already in the vector store.
 */
export function useCreateFileEmbeddings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      kbId: number
      filename: string
      chunkSize?: number
      chunkOverlap?: number
      splitterName?: string
    }) => {
      const url = new URL(
        `${API_BASE}/kb/${params.kbId}/files/embed`,
        window.location.origin,
      )
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: params.filename,
          chunk_size: params.chunkSize ?? 512,
          chunk_overlap: params.chunkOverlap ?? 200,
          splitter_name: params.splitterName ?? 'RecursiveCharacter',
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['vectordb', 'chunks', variables.kbId],
      })
    },
  })
}
