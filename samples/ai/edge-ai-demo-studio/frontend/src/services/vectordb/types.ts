// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export interface KnowledgeBase {
  id: number
  name: string
}

export interface SearchResult {
  content: string
  metadata: Record<string, unknown>
  score?: number
}

export interface Chunk {
  chunk_id: number
  doc_id: string
  content: string
  metadata: Record<string, unknown>
}

/** A document uploaded to a knowledge base (`GET /v1/kb/{id}/files`). */
export interface KbFile {
  id: number
  name: string
  ext: string
}

export interface ChunksResponse {
  kb_id: number
  total_chunks: number
  chunks: Chunk[]
}

/** `POST /v1/kb/{id}/files/embed` result (also the stream's `done` event). */
export interface FileEmbeddingsResult {
  success: boolean
  message: string
  file_info: {
    file_path: string
    chunks_created: number
    splitter_name: string
    chunk_size: number
    chunk_overlap: number
  }
}

/** Where the worker is with one file, as its progress events report. */
export type EmbedStage =
  'queued' | 'loading' | 'splitting' | 'embedding' | 'storing'

export interface EmbedFileProgress {
  stage: EmbedStage
  /** Chunks embedded so far, once the file is split. */
  chunksDone?: number
  /** Chunks the file split into. */
  chunksTotal?: number
  /** Embedding batches finished, and in all. */
  batch?: number
  batches?: number
  /** Operations on the knowledge base that run before this one. */
  ahead?: number
}

/** An embed run over several files, for the "Generate Embeddings" action. */
export interface EmbedRunProgress {
  /** Files finished, and in the run. */
  done: number
  total: number
  /** The file being embedded now. */
  file?: string
  /** How far that file is, once the worker reported anything. */
  current?: EmbedFileProgress
}

export type VectorDbBackendId = 'faiss' | 'pgvector'

export interface VectorDbBackendInfo {
  backend: VectorDbBackendId | null
  available: VectorDbBackendId[]
  /** pgvector only: 'embedded' (worker-managed PostgreSQL) or 'external' */
  mode?: 'embedded' | 'external'
  /** pgvector only: connection URL with the password hidden */
  connection?: string | null
  postgres_version?: string | null
}

export interface VectorDbConfig {
  embedding_url: string | null
  embedding_model: string | null
  reranker_url: string | null
  reranker_model: string | null
  db_backend: VectorDbBackendId
  backend: VectorDbBackendInfo
}
