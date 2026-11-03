// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ChevronRight } from 'lucide-react'
import { InlineNotice } from '@/components/common/inline-notice'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { plural } from '@/lib/browser/format'
import { useKnowledgeBaseWorkspace } from '../hooks/use-knowledge-base-workspace'
import {
  useEnsureVectorDbConfigured,
  type VectorDbSiblings,
} from '../hooks/use-vectordb-siblings'
import type { Chunk, KnowledgeBase } from '../types'
import { FileUploadPanel } from './file-upload-panel'
import { KnowledgeBasesRail } from './knowledge-bases-rail'

function ChunkViewer({
  chunks,
  totalChunks,
  fileCount,
}: {
  chunks: Chunk[]
  totalChunks: number
  fileCount: number
}) {
  return (
    <Collapsible className="space-y-1.5">
      <CollapsibleTrigger className="group bg-muted/30 hover:bg-muted/50 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors">
        <ChevronRight
          aria-hidden="true"
          className="text-muted-foreground h-3.5 w-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90"
        />
        <span className="text-muted-foreground font-mono text-xs">
          {plural(fileCount, 'file')} · {totalChunks} chunks · Vector store
          ready
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent className="max-h-[200px] space-y-1 overflow-y-auto pr-0.5">
        {chunks.map((chunk) => (
          <div
            key={chunk.doc_id}
            className="border-border bg-muted/20 rounded-lg border px-2.5 py-2 text-xs"
          >
            <div className="text-muted-foreground mb-1 flex items-center gap-2 font-mono text-xs">
              <span>#{chunk.chunk_id}</span>
              {chunk.metadata?.source ? (
                <>
                  <span aria-hidden="true" className="bg-border h-2.5 w-px" />
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
      </CollapsibleContent>
    </Collapsible>
  )
}

interface KnowledgeBasePanelProps {
  /** The RAG feature's vectordb instance address, e.g. `/api/vectordb@vector-db`. */
  apiBase: string | undefined
  selectedKb: KnowledgeBase | null
  onSelectKb: (kb: KnowledgeBase | null) => void
  /** The Embeddings / Rerank instances the worker embeds and ranks with. */
  siblings: VectorDbSiblings
}

/** A sample's knowledge base: pick or create one, add documents and embed them. */
export function KnowledgeBasePanel({
  apiBase,
  selectedKb,
  onSelectKb,
  siblings,
}: KnowledgeBasePanelProps) {
  const ensureConfigured = useEnsureVectorDbConfigured(apiBase, siblings)
  const {
    knowledgeBases,
    kbsQuery,
    kbName,
    setKbName,
    createKb,
    isCreatingKb,
    deleteKb,
    selectKb,
    isEmbedding,
    embedProgress,
    runEmbeddings,
    error,
    setError,
    chunksQuery,
    filesQuery,
  } = useKnowledgeBaseWorkspace({
    apiBase,
    selectedKb,
    onSelectKb,
    autoSelectCreated: true,
  })

  const files = filesQuery.data ?? []
  const totalChunks = chunksQuery.data?.total_chunks ?? 0

  return (
    <div className="space-y-4">
      {error && (
        <InlineNotice tone="destructive" size="sm">
          {error}
        </InlineNotice>
      )}

      <KnowledgeBasesRail
        knowledgeBases={knowledgeBases}
        selectedKb={selectedKb}
        kbName={kbName}
        onKbNameChange={setKbName}
        onCreate={createKb}
        isCreating={isCreatingKb}
        onRefresh={() => void kbsQuery.refetch()}
        isFetching={kbsQuery.isFetching}
        isLoading={kbsQuery.isLoading}
        loadError={kbsQuery.error}
        onSelect={selectKb}
        onDelete={deleteKb}
      />

      {selectedKb && (
        <FileUploadPanel
          apiBase={apiBase}
          kbId={selectedKb.id}
          embeddingsOnline={siblings.embeddingsOnline}
          // Only the files not embedded yet, one at a time (the per-file
          // endpoint is idempotent, so old files are never duplicated).
          onGenerateEmbeddings={(filenames) =>
            runEmbeddings(filenames, { beforeRun: ensureConfigured })
          }
          isEmbedding={isEmbedding}
          embedProgress={embedProgress}
          onError={setError}
          badge={selectedKb.name}
        >
          {siblings.embeddingsLabel && (
            <p
              className="text-muted-foreground text-xs"
              data-testid="rag-embeddings-instance"
            >
              {`Documents and questions are embedded by ${siblings.embeddingsLabel}.`}
            </p>
          )}
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
