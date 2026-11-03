// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Brain, FileText, Loader, Upload, X } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FileDropTarget } from '@/components/common/file-drop-target'
import { InlineNotice } from '@/components/common/inline-notice'
import { TruncatedText } from '@/components/common/truncated-text'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  checkDocuments,
  DOCUMENT_EXTENSIONS,
  MAX_DOCUMENT_BYTES,
  type SkippedFile,
  useKbDocuments,
} from '../hooks/use-kb-documents'
import type { EmbedRunProgress } from '../types'
import { EmbedFileStatus } from './embed-file-status'

const ACCEPTED_FILE_TYPES = DOCUMENT_EXTENSIONS.join(',')
const ACCEPTED_TYPES_LABEL = DOCUMENT_EXTENSIONS.map((ext) =>
  ext.slice(1).toUpperCase(),
).join(', ')

interface FileUploadPanelProps {
  /** This vectordb instance's address, e.g. `/api/vectordb@vector-db`. */
  apiBase: string | undefined
  kbId: number
  /** Whether the embeddings service is online (gates the embed action). */
  embeddingsOnline: boolean
  /** Embeds the given files: only those not yet in the vector store. */
  onGenerateEmbeddings: (filenames: string[]) => void | Promise<void>
  isEmbedding: boolean
  /** In-flight run: files done on the button, the current file's stage and chunks below it. */
  embedProgress?: EmbedRunProgress
  /** Upload errors, for the parent's banner. */
  onError?: (message: string) => void
  title?: string
  /** Shown beside the heading, e.g. the KB name. */
  badge?: string
  /** Rendered below the actions, e.g. a chunk viewer. */
  children?: ReactNode
}

/** "Documents" panel: upload files to a knowledge base, list and delete them, embed the new ones. */
export function FileUploadPanel({
  apiBase,
  kbId,
  embeddingsOnline,
  onGenerateEmbeddings,
  isEmbedding,
  embedProgress,
  onError,
  title = 'Documents',
  badge,
  children,
}: FileUploadPanelProps) {
  const documents = useKbDocuments(apiBase, kbId)
  const [fileToDelete, setFileToDelete] = useState<string | null>(null)
  /** Files of the last pick the worker would refuse, never sent. */
  const [skipped, setSkipped] = useState<SkippedFile[]>([])
  const { files, pendingFiles, embeddedNames } = documents

  const handleFiles = (picked: File[]) => {
    const checked = checkDocuments(picked)
    setSkipped(checked.skipped)
    if (checked.accepted.length > 0) {
      documents.upload(checked.accepted, (message) => onError?.(message))
    }
  }

  return (
    <Card className="gap-3.5 py-5">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2.5 text-sm">
          <FileText aria-hidden="true" className="text-primary h-4 w-4" />
          {title}
          {badge ? (
            <Badge variant="secondary" className="text-xs">
              {badge}
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-5">
        <FileDropTarget
          onFiles={handleFiles}
          accept={ACCEPTED_FILE_TYPES}
          multiple
          disabled={documents.isUploading}
          aria-label="Upload documents"
          className="rounded-xl p-6"
        >
          {documents.isUploading ? (
            <Loader
              aria-hidden="true"
              className="text-primary mx-auto mb-2 h-6 w-6 animate-spin"
            />
          ) : (
            <Upload
              aria-hidden="true"
              className="text-primary mx-auto mb-2 h-6 w-6"
            />
          )}
          <p className="text-foreground text-sm font-semibold">
            Upload PDF / TXT / DOCX files
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Drag &amp; drop or click to browse · up to{' '}
            {MAX_DOCUMENT_BYTES / 1024 ** 2} MB
          </p>
        </FileDropTarget>

        {skipped.length > 0 && (
          <InlineNotice
            tone="warning"
            size="sm"
            role="status"
            data-testid="vectordb-upload-skipped"
          >
            Not uploaded:{' '}
            {skipped.map((f) => `${f.name} (${f.reason})`).join(', ')}. The
            worker takes {ACCEPTED_TYPES_LABEL} files.
          </InlineNotice>
        )}

        {files.length > 0 && (
          <ul className="max-h-[160px] space-y-1 overflow-y-auto pr-0.5">
            {files.map((f) => {
              const embedded = embeddedNames.has(f.name)
              return (
                <li
                  key={f.name}
                  className="border-border bg-muted/20 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs"
                >
                  <FileText
                    aria-hidden="true"
                    className="text-primary h-3.5 w-3.5 shrink-0"
                  />
                  <TruncatedText
                    text={f.name}
                    className="text-foreground flex-1"
                  />
                  <Badge
                    variant={embedded ? 'secondary' : 'outline'}
                    className="text-xs"
                  >
                    {embedded ? 'Embedded' : 'Not embedded'}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-destructive shrink-0"
                    disabled={documents.isRemoving}
                    aria-label={`Remove ${f.name}`}
                    title="Remove file"
                    onClick={() => setFileToDelete(f.name)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}

        <Button
          onClick={() =>
            void onGenerateEmbeddings(pendingFiles.map((f) => f.name))
          }
          disabled={
            isEmbedding || !embeddingsOnline || pendingFiles.length === 0
          }
          className="w-full gap-2"
        >
          {isEmbedding ? (
            <>
              <Loader aria-hidden="true" className="h-4 w-4 animate-spin" />
              {embedProgress
                ? `Embedding… ${embedProgress.done}/${embedProgress.total}`
                : 'Embedding…'}
            </>
          ) : (
            <>
              <Brain aria-hidden="true" className="h-4 w-4" />
              Generate embeddings
              {pendingFiles.length > 0 ? ` (${pendingFiles.length})` : ''}
            </>
          )}
        </Button>

        {isEmbedding && embedProgress?.file ? (
          <EmbedFileStatus run={embedProgress} />
        ) : null}

        {children}

        {!embeddingsOnline && (
          <p className="text-warning-strong text-xs">
            Start the Embeddings instance to generate embeddings from uploaded
            files.
          </p>
        )}
      </CardContent>

      <ConfirmDialog
        open={fileToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setFileToDelete(null)
        }}
        variant="destructive"
        title={`Delete “${fileToDelete ?? ''}”?`}
        description="This removes the file and deletes all chunks that were embedded from it from the vector store. This can’t be undone."
        confirmLabel="Delete File"
        pendingLabel="Deleting…"
        onConfirm={async () => {
          if (fileToDelete) await documents.removeFile(fileToDelete)
        }}
      />
    </Card>
  )
}
