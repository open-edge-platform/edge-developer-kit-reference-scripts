// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { CheckCircle2, Database, X } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '@/components/common/empty-state'
import { InlineNotice } from '@/components/common/inline-notice'
import { Button } from '@/components/ui/button'
import { getErrorMessage } from '@/lib/errors'
import type { Service } from '@/services/types'
import { ActiveKbBar } from './components/active-kb-bar'
import { AddChunkPanel } from './components/add-chunk-panel'
import { ChunksPanel } from './components/chunks-panel'
import { DependencyPanel } from './components/dependency-panel'
import { FileUploadPanel } from './components/file-upload-panel'
import { KnowledgeBasesRail } from './components/knowledge-bases-rail'
import { PipelineSteps } from './components/pipeline-steps'
import { SearchPanel } from './components/search-panel'
import {
  useAddChunk,
  useDeleteChunks,
  useReplaceChunk,
  useSearchKb,
  useVectorDbConfig,
} from './hooks'
import { embeddedFileNames } from './hooks/use-kb-documents'
import { useKnowledgeBaseWorkspace } from './hooks/use-knowledge-base-workspace'
import { useVectorDbDependencies } from './hooks/use-vectordb-dependencies'
import { useEnsureVectorDbConfigured } from './hooks/use-vectordb-siblings'
import type { KnowledgeBase, VectorDbBackendInfo } from './types'

function describeBackend(info: VectorDbBackendInfo | undefined): string | null {
  if (!info?.backend) return null
  if (info.backend === 'faiss') return 'FAISS (on-disk index)'
  const where =
    info.mode === 'external'
      ? (info.connection ?? 'external PostgreSQL')
      : 'embedded PostgreSQL'
  const version = info.postgres_version ? ` ${info.postgres_version}` : ''
  return `pgvector · ${where}${version}`
}

export function VectorDbDemo({ service }: { service: Service }) {
  const { apiBase } = service
  const workerConfigQuery = useVectorDbConfig(apiBase)
  const dependencies = useVectorDbDependencies(service, workerConfigQuery.data)
  const { siblings } = dependencies
  const ensureConfigured = useEnsureVectorDbConfigured(apiBase, siblings)
  const { embeddingsOnline } = siblings

  const [selectedKb, setSelectedKb] = useState<KnowledgeBase | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  /** The knowledge base just created (and made active), for its notice. */
  const [created, setCreated] = useState<KnowledgeBase | null>(null)

  // Each call points the worker at the chosen Embeddings instance first,
  // as part of the call, so it is busy from the click.
  const { mutateAsync: addChunk, isPending: isAdding } = useAddChunk(
    apiBase,
    ensureConfigured,
  )
  const { mutateAsync: replaceChunk, isPending: isReplacing } = useReplaceChunk(
    apiBase,
    ensureConfigured,
  )
  const { mutateAsync: deleteChunks, isPending: isDeleting } =
    useDeleteChunks(apiBase)
  const searchMutation = useSearchKb(apiBase, ensureConfigured)
  const { reset: resetSearch } = searchMutation

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
    chunksQuery: kbChunksQuery,
    filesQuery: kbFilesQuery,
  } = useKnowledgeBaseWorkspace({
    apiBase,
    selectedKb,
    // A search's results belong to the knowledge base it ran on.
    onSelectKb: (kb) => {
      if (kb?.id !== selectedKb?.id) resetSearch()
      if (kb?.id !== created?.id) setCreated(null)
      setSelectedKb(kb)
    },
    // A new knowledge base becomes the target of every action at once, so
    // nothing lands in the previous one by mistake.
    autoSelectCreated: true,
    onCreated: setCreated,
    onSelectedKbDeleted: () => resetSearch(),
  })

  /** Runs `work`; a failure lands in the banner and rejects (so a form keeps its input). */
  const reportFailure = async (
    work: () => Promise<unknown>,
    failure: string,
  ) => {
    setError(null)
    try {
      await work()
    } catch (err) {
      setError(getErrorMessage(err, failure))
      throw err
    }
  }

  const handleAddChunk = (content: string) => {
    if (!selectedKb) return Promise.resolve()
    return reportFailure(
      () => addChunk({ kbId: selectedKb.id, content }),
      'Failed to add chunk',
    )
  }

  const handleReplaceChunk = (docId: string, content: string) => {
    if (!selectedKb) return Promise.resolve()
    return reportFailure(
      () => replaceChunk({ kbId: selectedKb.id, docId, content }),
      'Failed to update chunk',
    )
  }

  const handleDeleteChunk = async (docId: string) => {
    if (!selectedKb) return
    await deleteChunks({ kbId: selectedKb.id, docIds: [docId] })
  }

  const isSearching = searchMutation.isPending
  const handleSearch = () => {
    if (!selectedKb || !searchQuery.trim() || isSearching) return
    setError(null)
    // A search reset by a switch of knowledge base reports nothing.
    searchMutation.mutate(
      { kbId: selectedKb.id, query: searchQuery.trim() },
      { onError: (err) => setError(getErrorMessage(err, 'Search failed')) },
    )
  }
  // Only results of the knowledge base shown.
  const searchResults =
    selectedKb && searchMutation.variables?.kbId === selectedKb.id
      ? searchMutation.data
      : undefined

  const backendLabel = describeBackend(workerConfigQuery.data?.backend)
  const chunks = kbChunksQuery.data?.chunks ?? []
  const totalChunks = kbChunksQuery.data?.total_chunks ?? 0
  const files = kbFilesQuery.data ?? []
  const embedded = embeddedFileNames(chunks)
  const pendingCount = files.filter((f) => !embedded.has(f.name)).length
  const embeddingsName = siblings.embeddingsLabel ?? 'The Embeddings service'

  return (
    <div className="flex flex-col gap-5 lg:flex-row">
      <div className="lg:sticky lg:top-4 lg:w-[300px] lg:shrink-0 lg:self-start">
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
      </div>

      <div className="min-w-0 flex-1 space-y-5">
        {created && created.id === selectedKb?.id && (
          <InlineNotice
            tone="success"
            size="sm"
            role="status"
            data-testid="vectordb-created-notice"
            icon={
              <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0" />
            }
            action={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Dismiss"
                onClick={() => setCreated(null)}
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </Button>
            }
          >
            Created “{created.name}”. It is now the active knowledge base:
            uploads, chunks and searches go to it.
          </InlineNotice>
        )}

        {!embeddingsOnline && (
          <InlineNotice tone="warning" size="sm" role="status">
            {siblings.embeddingsKey
              ? `${embeddingsName} is not running. Start it, or choose a running Embeddings instance below, to add chunks and search by text.`
              : 'No Embeddings instance is available. Add and start one to add chunks and search by text.'}
          </InlineNotice>
        )}

        {error && (
          <InlineNotice tone="destructive" size="sm">
            {error}
          </InlineNotice>
        )}

        <ActiveKbBar
          selectedKb={selectedKb}
          chunkCount={totalChunks}
          documentCount={files.length}
        />

        {selectedKb ? (
          <>
            <PipelineSteps
              embeddingsName={siblings.embeddingsLabel}
              documentCount={files.length}
              pendingCount={pendingCount}
              chunkCount={totalChunks}
              isEmbedding={isEmbedding}
              searched={searchResults !== undefined}
            />
            <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
              <div className="space-y-5">
                <FileUploadPanel
                  apiBase={apiBase}
                  kbId={selectedKb.id}
                  embeddingsOnline={embeddingsOnline}
                  onGenerateEmbeddings={(filenames) =>
                    runEmbeddings(filenames, { beforeRun: ensureConfigured })
                  }
                  isEmbedding={isEmbedding}
                  embedProgress={embedProgress}
                  onError={setError}
                  title="Upload and embed documents"
                />

                <AddChunkPanel
                  canMutate={embeddingsOnline}
                  isAdding={isAdding}
                  onAddChunk={handleAddChunk}
                />
              </div>

              <div className="space-y-5">
                <SearchPanel
                  query={searchQuery}
                  onQueryChange={setSearchQuery}
                  onSearch={handleSearch}
                  isSearching={isSearching}
                  disabled={!embeddingsOnline}
                  results={searchResults}
                  knowledgeBaseName={selectedKb.name}
                />

                <ChunksPanel
                  chunks={chunks}
                  totalChunks={totalChunks}
                  isLoading={kbChunksQuery.isLoading}
                  isFetching={kbChunksQuery.isFetching}
                  loadError={kbChunksQuery.error}
                  canMutate={embeddingsOnline}
                  isUpdating={isAdding || isReplacing || isDeleting}
                  onRefresh={() => void kbChunksQuery.refetch()}
                  onDeleteChunk={handleDeleteChunk}
                  onReplaceChunk={handleReplaceChunk}
                />
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            icon={Database}
            description="Select or create a knowledge base to get started."
            className="py-10"
          />
        )}

        {/* Set up once, so it comes after the knowledge-base work. */}
        <DependencyPanel
          dependencies={dependencies}
          workerConfig={workerConfigQuery.data}
        />

        {backendLabel && (
          <p
            data-testid="vectordb-backend-label"
            className="text-muted-foreground text-xs"
          >
            Storage backend: <span className="font-medium">{backendLabel}</span>
          </p>
        )}
      </div>
    </div>
  )
}
