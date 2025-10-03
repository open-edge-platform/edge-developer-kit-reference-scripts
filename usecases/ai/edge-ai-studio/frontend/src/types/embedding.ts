// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export interface CreateTextEmbeddingProps {
  input: string | string[]
  model: string
  encoding_format?: 'float' | 'base64'
  dimensions?: number
  user?: string
}

export interface KnowledgeBase {
  id?: number
  name: string
  db?: string
}

export interface KnowledgeBaseFile {
  id: number
  name: string
  ext: string
}

export interface CreateKBProps {
  name: string
}

export interface UploadFileProps {
  kbId: number
  file: File
}

export interface SearchKBProps {
  kbId: number
  query: string
}

export interface SearchResult {
  content: string
  metadata: Record<string, unknown>
}
