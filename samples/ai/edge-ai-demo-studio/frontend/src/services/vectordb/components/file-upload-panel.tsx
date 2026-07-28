// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Brain, FileText, Loader2, Upload, X } from 'lucide-react'
import { type ReactNode, useMemo, useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  type KbFile,
  useDeleteChunksByIds,
  useDeleteFile,
  useKbChunks,
  useKbFiles,
  useUploadFile,
} from '../hooks'
import { PanelCard } from './panel-card'

const ACCEPTED_FILE_TYPES = '.pdf,.txt,.csv,.json,.html,.docx'

/** Last path segment, so an absolute/relative chunk `source` matches a filename. */
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p

interface FileUploadPanelProps {
  /** Knowledge base whose documents are managed. */
  kbId: number
  /** Whether the embeddings service is online (gates the embed action). */
  embeddingsOnline: boolean
  /**
   * Embed the given files. Receives only the filenames that still need
   * embedding (files not yet present in the vector store).
   */
  onGenerateEmbeddings: (filenames: string[]) => void | Promise<void>
  /** Whether an embedding generation is currently in progress. */
  isEmbedding: boolean
  /** Optional progress for the in-flight embed run, shown on the button. */
  embedProgress?: { done: number; total: number }
  /** Surface upload/delete errors to the parent (which renders the banner). */
  onError?: (message: string) => void
  /** Optional label shown beside the "Documents" heading (e.g. the KB name). */
  badge?: string
  /** Extra content rendered below the actions (e.g. a chunk viewer). */
  children?: ReactNode
}

/**
 * "Documents" panel: drag-and-drop (or browse) upload of files to a knowledge
 * base, list and delete them, then embed the ones that aren't embedded yet.
 * "Already embedded" is derived from the vector store (chunk `source`), so it
 * survives reloads and never re-embeds — hence never duplicates — a file.
 */
export function FileUploadPanel({
  kbId,
  embeddingsOnline,
  onGenerateEmbeddings,
  isEmbedding,
  embedProgress,
  onError,
  badge,
  children,
}: FileUploadPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)
  const filesQuery = useKbFiles(kbId)
  const chunksQuery = useKbChunks(kbId)
  const uploadFileMutation = useUploadFile()
  const deleteFileMutation = useDeleteFile()
  const deleteChunksMutation = useDeleteChunksByIds()
  const { mutate: deleteChunksByIds } = deleteChunksMutation

  const files = useMemo(() => filesQuery.data ?? [], [filesQuery.data])
  const chunks = useMemo(
    () => chunksQuery.data?.chunks ?? [],
    [chunksQuery.data],
  )

  // Files already represented in the vector store, keyed by filename.
  const embeddedNames = useMemo(
    () =>
      new Set(
        chunks
          .map((c) => baseName(String(c.metadata?.source ?? '')))
          .filter(Boolean),
      ),
    [chunks],
  )
  const pendingFiles = useMemo(
    () => files.filter((f) => !embeddedNames.has(f.name)),
    [files, embeddedNames],
  )

  const docIdsForFile = (filename: string) =>
    chunks
      .filter((c) => baseName(String(c.metadata?.source ?? '')) === filename)
      .map((c) => c.doc_id)

  const uploadFiles = (fileList: FileList | File[]) => {
    for (const file of Array.from(fileList)) {
      uploadFileMutation.mutate(
        { kbId, file },
        {
          // If a file with this name was already embedded, drop its stale
          // chunks so the re-uploaded version shows up as pending again.
          onSuccess: () => {
            const stale = docIdsForFile(file.name)
            if (stale.length) deleteChunksByIds({ kbId, docIds: stale })
          },
          onError: (err) =>
            onError?.(
              err instanceof Error
                ? err.message
                : `Failed to upload ${file.name}`,
            ),
        },
      )
    }
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) uploadFiles(e.target.files)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current === 0) setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setIsDragging(false)
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files)
  }

  // Deleting a file also removes every chunk embedded from it, so the vector
  // store stays consistent with the file list.
  const handleDeleteFile = (filename: string) => {
    deleteFileMutation.mutate(
      { kbId, filename },
      {
        onError: (err) =>
          onError?.(
            err instanceof Error ? err.message : 'Failed to delete file',
          ),
      },
    )
    const ids = docIdsForFile(filename)
    if (ids.length) {
      deleteChunksByIds(
        { kbId, docIds: ids },
        {
          onError: (err) =>
            onError?.(
              err instanceof Error
                ? err.message
                : `Failed to delete chunks for ${filename}`,
            ),
        },
      )
    }
  }

  const isDeleting =
    deleteFileMutation.isPending || deleteChunksMutation.isPending

  const handleGenerate = () => {
    onGenerateEmbeddings(pendingFiles.map((f) => f.name))
  }

  return (
    <PanelCard
      icon={FileText}
      title={
        <span className="flex items-center gap-2">
          Documents
          {badge ? (
            <Badge variant="secondary" className="text-[10px]">
              {badge}
            </Badge>
          ) : null}
        </span>
      }
      bodyClassName="space-y-3"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        multiple
        onChange={handleFileInput}
        className="hidden"
      />

      <div
        onClick={() => fileInputRef.current?.click()}
        onDragEnter={handleDragEnter}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors',
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/40',
          uploadFileMutation.isPending && 'pointer-events-none opacity-60',
        )}
      >
        {uploadFileMutation.isPending ? (
          <Loader2 className="text-primary mx-auto mb-2 h-6 w-6 animate-spin" />
        ) : (
          <Upload className="text-primary mx-auto mb-2 h-6 w-6" />
        )}
        <p className="text-foreground text-sm font-semibold">
          Upload PDF / TXT / DOCX files
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Drag &amp; drop or click to browse
        </p>
      </div>

      {files.length > 0 && (
        <div className="max-h-[160px] space-y-1 overflow-y-auto pr-0.5">
          {files.map((f: KbFile) => {
            const embedded = embeddedNames.has(f.name)
            return (
              <div
                key={f.name}
                className="border-border bg-muted/20 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs"
              >
                <FileText className="text-primary h-3.5 w-3.5 shrink-0" />
                <span className="text-foreground min-w-0 flex-1 truncate">
                  {f.name}
                </span>
                <Badge
                  variant={embedded ? 'secondary' : 'outline'}
                  className="text-[9px]"
                >
                  {embedded ? 'Processed' : 'Pending'}
                </Badge>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      disabled={isDeleting}
                      title="Remove file"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete “{f.name}”?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This removes the file and deletes all chunks that were
                        embedded from it from the vector store. This can’t be
                        undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleDeleteFile(f.name)}
                        className="bg-destructive hover:bg-destructive/90 text-white"
                      >
                        Delete File
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )
          })}
        </div>
      )}

      <Button
        onClick={handleGenerate}
        disabled={isEmbedding || !embeddingsOnline || pendingFiles.length === 0}
        className="bg-primary hover:bg-primary-light w-full gap-2 text-white"
      >
        {isEmbedding ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {embedProgress
              ? `Embedding… ${embedProgress.done}/${embedProgress.total}`
              : 'Embedding…'}
          </>
        ) : (
          <>
            <Brain className="h-4 w-4" />
            Generate Embeddings
            {pendingFiles.length > 0 ? ` (${pendingFiles.length})` : ''}
          </>
        )}
      </Button>

      {children}

      {!embeddingsOnline && (
        <p className="text-warning text-xs">
          Start the Embeddings service to generate embeddings from uploaded
          files.
        </p>
      )}
    </PanelCard>
  )
}
