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

export interface ChunksResponse {
  kb_id: number
  total_chunks: number
  chunks: Chunk[]
}
