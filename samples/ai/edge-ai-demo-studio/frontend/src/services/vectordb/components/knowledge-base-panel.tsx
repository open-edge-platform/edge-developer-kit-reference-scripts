// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  Brain,
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  FolderPlus,
  Loader2,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  useConfigureEmbedding,
  useCreateEmbeddings,
  useCreateKb,
  useDeleteFile,
  useDeleteKb,
  type KbFile,
  useKbFiles,
  useKnowledgeBases,
  useUploadFile,
  useKbChunks,
} from '@/services/vectordb/hooks'
import type { Chunk, KnowledgeBase } from '@/services/vectordb/types'

const ACCEPTED_FILE_TYPES = '.pdf,.txt,.csv,.json,.html,.docx'

function ChunkViewer({
  chunks,
  totalChunks,
  fileCount,
}: {
  chunks: Chunk[]
  totalChunks: number
  fileCount: number
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="bg-muted/30 hover:bg-muted/50 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors"
      >
        {expanded ? (
          <ChevronDown className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
        )}
        <span className="text-muted-foreground font-mono text-xs">
          {fileCount} file{fileCount !== 1 ? 's' : ''} · {totalChunks} chunks ·
          Vector store ready
        </span>
      </button>

      {expanded && (
        <div className="max-h-[200px] space-y-1 overflow-y-auto pr-0.5">
          {chunks.map((chunk) => (
            <div
              key={chunk.doc_id}
              className="border-border bg-muted/20 rounded-lg border px-2.5 py-2 text-xs"
            >
              <div className="text-muted-foreground mb-1 flex items-center gap-2 font-mono text-[10px]">
                <span>#{chunk.chunk_id}</span>
                {chunk.metadata?.source ? (
                  <>
                    <span className="bg-border h-2.5 w-px" />
                    <span className="truncate">
                      {String(chunk.metadata.source)}
                    </span>
                  </>
                ) : null}
              </div>
              <p className="text-foreground/80 line-clamp-3 leading-relaxed">
                {chunk.content}
              </p>
            </div>
          ))}
          {chunks.length === 0 && (
            <p className="text-muted-foreground py-2 text-center text-xs">
              No chunks to display
            </p>
          )}
        </div>
      )}
    </div>
  )
}

interface KnowledgeBasePanelProps {
  selectedKb: KnowledgeBase | null
  onSelectKb: (kb: KnowledgeBase | null) => void
  embeddingsOnline: boolean
  embeddingPort?: number
  embeddingModelName?: string
  rerankPort?: number
  rerankModelName?: string
}

export function KnowledgeBasePanel({
  selectedKb,
  onSelectKb,
  embeddingsOnline,
  embeddingPort,
  embeddingModelName,
  rerankPort,
  rerankModelName,
}: KnowledgeBasePanelProps) {
  const [kbName, setKbName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const kbsQuery = useKnowledgeBases()
  const createKbMutation = useCreateKb()
  const deleteKbMutation = useDeleteKb()
  const uploadFileMutation = useUploadFile()
  const { mutate: uploadFile } = uploadFileMutation
  const deleteFileMutation = useDeleteFile()
  const createEmbeddingsMutation = useCreateEmbeddings()
  const configureMutation = useConfigureEmbedding()
  const filesQuery = useKbFiles(selectedKb?.id)
  const chunksQuery = useKbChunks(selectedKb?.id)

  const knowledgeBases = kbsQuery.data ?? []
  const files = filesQuery.data ?? []
  const totalChunks = chunksQuery.data?.total_chunks ?? 0

  const handleCreateKb = () => {
    if (!kbName.trim()) return
    setError(null)
    createKbMutation.mutate(kbName.trim(), {
      onSuccess: (kb) => {
        setKbName('')
        onSelectKb(kb)
      },
      onError: (err) =>
        setError(err instanceof Error ? err.message : 'Failed to create KB'),
    })
  }

  const handleDeleteKb = (id: number) => {
    setError(null)
    deleteKbMutation.mutate(id, {
      onSuccess: () => {
        if (selectedKb?.id === id) onSelectKb(null)
      },
      onError: (err) =>
        setError(err instanceof Error ? err.message : 'Failed to delete KB'),
    })
  }

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!selectedKb || !e.target.files) return
      setError(null)
      const fileList = Array.from(e.target.files)
      for (const file of fileList) {
        uploadFile(
          { kbId: selectedKb.id, file },
          {
            onError: (err) =>
              setError(
                err instanceof Error
                  ? err.message
                  : `Failed to upload ${file.name}`,
              ),
          },
        )
      }
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [selectedKb, uploadFile],
  )

  const handleDeleteFile = (filename: string) => {
    if (!selectedKb) return
    setError(null)
    deleteFileMutation.mutate(
      { kbId: selectedKb.id, filename },
      {
        onSuccess: () => filesQuery.refetch(),
        onError: (err) =>
          setError(
            err instanceof Error ? err.message : 'Failed to delete file',
          ),
      },
    )
  }

  const handleCreateEmbeddings = () => {
    if (!selectedKb) return
    setError(null)

    if (!embeddingPort || !embeddingModelName) {
      setError('Embeddings service is not configured')
      return
    }
    configureMutation.mutate(
      {
        embeddingUrl: `http://localhost:${embeddingPort}/v1`,
        embeddingModel: embeddingModelName,
        rerankerUrl: rerankPort
          ? `http://localhost:${rerankPort}/v1`
          : undefined,
        rerankerModel: rerankModelName,
      },
      {
        onSuccess: () => {
          createEmbeddingsMutation.mutate(
            { kbId: selectedKb.id },
            {
              onSuccess: () => chunksQuery.refetch(),
              onError: (err) =>
                setError(
                  err instanceof Error
                    ? err.message
                    : 'Failed to create embeddings',
                ),
            },
          )
        },
        onError: (err) =>
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to configure embedding service',
          ),
      },
    )
  }

  const isEmbedding =
    configureMutation.isPending || createEmbeddingsMutation.isPending

  return (
    <div className="space-y-4">
      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-lg border p-2 text-xs">
          {error}
        </div>
      )}

      <div className="border-border bg-muted/10 space-y-3 rounded-xl border p-4">
        <div className="text-foreground flex items-center gap-2 text-sm font-medium">
          <Database className="text-primary h-4 w-4" />
          Knowledge Bases
        </div>

        <div className="flex gap-2">
          <Input
            value={kbName}
            onChange={(e) => setKbName(e.target.value)}
            placeholder="New knowledge base…"
            className="bg-muted/30 text-sm"
            onKeyDown={(e) => e.key === 'Enter' && handleCreateKb()}
          />
          <Button
            onClick={handleCreateKb}
            disabled={createKbMutation.isPending || !kbName.trim()}
            size="icon"
            className="bg-primary hover:bg-primary-light shrink-0 text-white"
          >
            {createKbMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FolderPlus className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div className="max-h-[180px] space-y-1.5 overflow-auto">
          {knowledgeBases.length === 0 ? (
            <div className="text-muted-foreground py-4 text-center text-xs">
              {kbsQuery.isLoading ? 'Loading…' : 'No knowledge bases yet'}
            </div>
          ) : (
            knowledgeBases.map((kb) => (
              <div
                role="button"
                tabIndex={0}
                key={kb.id}
                className={cn(
                  'flex w-full cursor-pointer items-center justify-between rounded-lg border p-2 text-left text-sm transition-colors',
                  selectedKb?.id === kb.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/30',
                )}
                onClick={() => onSelectKb(kb)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelectKb(kb)
                  }
                }}
              >
                <span className="truncate text-xs">{kb.name}</span>
                <div className="flex items-center gap-1">
                  <Badge variant="secondary" className="text-[10px]">
                    {kb.id}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteKb(kb.id)
                    }}
                  >
                    <Trash2 className="text-destructive h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {selectedKb && (
        <div className="border-border bg-muted/10 space-y-3 rounded-xl border p-4">
          <div className="text-foreground flex items-center gap-2 text-sm font-medium">
            <FileText className="text-primary h-4 w-4" />
            Documents
            <Badge variant="secondary" className="text-[10px]">
              {selectedKb.name}
            </Badge>
          </div>

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              multiple
              onChange={handleFileUpload}
              className="hidden"
            />
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2 text-xs"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadFileMutation.isPending}
            >
              {uploadFileMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              Upload PDF / TXT files
            </Button>
          </div>

          {files.length > 0 && (
            <div className="max-h-[160px] min-h-0 space-y-1 overflow-y-auto pr-0.5">
              {files.map((f: KbFile) => (
                <div
                  key={f.name}
                  className="border-border bg-muted/20 flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs"
                >
                  <FileText className="text-primary h-3 w-3 shrink-0" />
                  <span className="text-foreground min-w-0 flex-1 truncate">
                    {f.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDeleteFile(f.name)}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <Button
            onClick={handleCreateEmbeddings}
            disabled={isEmbedding || !embeddingsOnline || files.length === 0}
            size="sm"
            className="bg-primary hover:bg-primary-light w-full gap-2 text-white"
          >
            {isEmbedding ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Embedding…
              </>
            ) : (
              <>
                <Brain className="h-3.5 w-3.5" />
                Generate Embeddings
              </>
            )}
          </Button>

          {totalChunks > 0 && (
            <ChunkViewer
              chunks={chunksQuery.data?.chunks ?? []}
              totalChunks={totalChunks}
              fileCount={files.length}
            />
          )}

          {!embeddingsOnline && (
            <p className="text-warning text-xs">
              Start the Embeddings service to generate embeddings.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
