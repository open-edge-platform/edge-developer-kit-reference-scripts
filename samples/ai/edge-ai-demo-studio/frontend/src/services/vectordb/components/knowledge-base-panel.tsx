// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import {
  useConfigureEmbedding,
  useCreateFileEmbeddings,
  useCreateKb,
  useDeleteKb,
  useKbFiles,
  useKnowledgeBases,
  useKbChunks,
} from '@/services/vectordb/hooks'
import type { Chunk, KnowledgeBase } from '@/services/vectordb/types'
import { FileUploadPanel } from './file-upload-panel'
import { KnowledgeBasesRail } from './knowledge-bases-rail'

type EmbedRun = { running: boolean; done: number; total: number }
const IDLE_RUN: EmbedRun = { running: false, done: 0, total: 0 }

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

  const kbsQuery = useKnowledgeBases()
  const createKbMutation = useCreateKb()
  const deleteKbMutation = useDeleteKb()
  const embedFileMutation = useCreateFileEmbeddings()
  const configureMutation = useConfigureEmbedding()
  const [embedRun, setEmbedRun] = useState<EmbedRun>(IDLE_RUN)
  // Shared with FileUploadPanel via react-query cache; used here only for the
  // file count shown in the chunk viewer.
  const filesQuery = useKbFiles(selectedKb?.id)
  const chunksQuery = useKbChunks(selectedKb?.id)

  // Reset embed progress whenever the selected KB changes so it can't leak.
  const selectKb = (kb: KnowledgeBase | null) => {
    onSelectKb(kb)
    setEmbedRun(IDLE_RUN)
  }

  const knowledgeBases = kbsQuery.data ?? []
  const files = filesQuery.data ?? []
  const totalChunks = chunksQuery.data?.total_chunks ?? 0

  const handleCreateKb = () => {
    if (!kbName.trim()) return
    setError(null)
    createKbMutation.mutate(kbName.trim(), {
      onSuccess: (kb) => {
        setKbName('')
        selectKb(kb)
      },
      onError: (err) =>
        setError(err instanceof Error ? err.message : 'Failed to create KB'),
    })
  }

  const handleDeleteKb = (id: number) => {
    setError(null)
    deleteKbMutation.mutate(id, {
      onSuccess: () => {
        if (selectedKb?.id === id) selectKb(null)
      },
      onError: (err) =>
        setError(err instanceof Error ? err.message : 'Failed to delete KB'),
    })
  }

  // Configure the embedding service once, then embed only the pending files one
  // at a time (per-file endpoint is idempotent, so old files aren't duplicated).
  const handleCreateEmbeddings = async (filenames: string[]) => {
    if (!selectedKb || filenames.length === 0) return
    setError(null)

    if (!embeddingPort || !embeddingModelName) {
      setError('Embeddings service is not configured')
      return
    }

    setEmbedRun({ running: true, done: 0, total: filenames.length })
    try {
      await configureMutation.mutateAsync({
        embeddingUrl: `http://localhost:${embeddingPort}/v1`,
        embeddingModel: embeddingModelName,
        rerankerUrl: rerankPort
          ? `http://localhost:${rerankPort}/v1`
          : undefined,
        rerankerModel: rerankModelName,
      })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to configure embedding service',
      )
      setEmbedRun(IDLE_RUN)
      return
    }

    for (const filename of filenames) {
      try {
        await embedFileMutation.mutateAsync({ kbId: selectedKb.id, filename })
        setEmbedRun((r) => ({ ...r, done: r.done + 1 }))
      } catch (err) {
        setError(
          err instanceof Error ? err.message : `Failed to embed ${filename}`,
        )
      }
    }
    setEmbedRun(IDLE_RUN)
    chunksQuery.refetch()
  }

  const isEmbedding = embedRun.running

  return (
    <div className="space-y-4">
      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-lg border p-2 text-xs">
          {error}
        </div>
      )}

      <KnowledgeBasesRail
        knowledgeBases={knowledgeBases}
        selectedKb={selectedKb}
        kbName={kbName}
        onKbNameChange={setKbName}
        onCreate={handleCreateKb}
        isCreating={createKbMutation.isPending}
        onRefresh={() => kbsQuery.refetch()}
        isFetching={kbsQuery.isFetching}
        isLoading={kbsQuery.isLoading}
        onSelect={selectKb}
        onDelete={handleDeleteKb}
      />

      {selectedKb && (
        <FileUploadPanel
          kbId={selectedKb.id}
          embeddingsOnline={embeddingsOnline}
          onGenerateEmbeddings={handleCreateEmbeddings}
          isEmbedding={isEmbedding}
          embedProgress={
            embedRun.running
              ? { done: embedRun.done, total: embedRun.total }
              : undefined
          }
          onError={setError}
          badge={selectedKb.name}
        >
          {totalChunks > 0 && (
            <ChunkViewer
              chunks={chunksQuery.data?.chunks ?? []}
              totalChunks={totalChunks}
              fileCount={files.length}
            />
          )}
        </FileUploadPanel>
      )}
    </div>
  )
}
