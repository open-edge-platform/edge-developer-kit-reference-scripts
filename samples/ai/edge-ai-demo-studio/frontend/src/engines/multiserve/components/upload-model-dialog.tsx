// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  AlertCircle,
  CheckCircle2,
  FileArchive,
  File as FileGlyph,
  Loader,
  Upload,
  X,
} from 'lucide-react'
import { useId, useState } from 'react'
import { FileDropZone } from '@/components/common/file-drop-zone'
import { InlineNotice } from '@/components/common/inline-notice'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import type { BackendId } from '@/engines/multiserve/types'
import type { UploadProgress } from '@/engines/multiserve/upload'
import { validateUploadModelName } from '@/engines/multiserve/validation'
import { formatBytes } from '@/lib/browser/format'

function acceptedExtensions(backend: BackendId): string {
  return backend === 'llamacpp' ? '.gguf' : '.zip'
}

function acceptedMimeTypes(backend: BackendId): string {
  return backend === 'llamacpp'
    ? '.gguf,application/octet-stream'
    : '.zip,application/zip'
}

function percentOf(sent: number, total: number): number {
  return total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 100
}

interface UploadModelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  backend: BackendId
  taskType: string
  onUpload: (params: {
    backend: BackendId
    repoId: string
    task: string
    files: File[]
  }) => void
  /** Stops the upload in flight between two chunks. */
  onCancelUpload: () => void
  isUploading: boolean
  /** Bytes the engine has accepted so far; null before the first report. */
  uploadProgress: UploadProgress | null
  isUploadSuccess: boolean
  uploadError: Error | null
  /** Shown under the file while `isUploading` has no progress yet (e.g. "Starting engine…"). */
  pendingMessage?: string
}

/** Uploads a local model (`.gguf` for llama.cpp, else a zipped OpenVINO folder) under a name. */
export function UploadModelDialog({
  open,
  onOpenChange,
  backend,
  taskType,
  onUpload,
  onCancelUpload,
  isUploading,
  uploadProgress,
  isUploadSuccess,
  uploadError,
  pendingMessage,
}: UploadModelDialogProps) {
  const [modelName, setModelName] = useState('')
  const hintId = useId()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const nameError =
    modelName.trim() && !validateUploadModelName(modelName, backend)
      ? backend === 'llamacpp'
        ? 'Must contain "GGUF" and follow org/model or org/model:QUANT format.'
        : 'Must follow org/model format (e.g. OpenVINO/model-name).'
      : ''

  const validateModelFile = (file: File) => {
    const ext = acceptedExtensions(backend)
    return file.name.toLowerCase().endsWith(ext)
      ? null
      : `Only ${ext} files are accepted for ${backend}.`
  }

  const isValid =
    modelName.trim().length > 0 && !nameError && selectedFile !== null

  const handleUpload = () => {
    if (!isValid || !selectedFile) return
    onUpload({
      backend,
      repoId: modelName,
      task: taskType,
      files: [selectedFile],
    })
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !isUploading) {
      setModelName('')
      setSelectedFile(null)
    }
    onOpenChange(nextOpen)
  }

  const placeholder =
    backend === 'llamacpp' ? 'Qwen/Qwen3-4B-GGUF' : 'my-org/my-custom-model'

  const FileIcon = backend === 'llamacpp' ? FileGlyph : FileArchive

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="upload-model-dialog" className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            Upload Model
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs">
            Upload a local model file ({acceptedExtensions(backend)}).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label
              htmlFor="upload-model-name"
              className="text-foreground text-xs font-medium"
            >
              Model Name
            </Label>
            <Input
              id="upload-model-name"
              data-testid="upload-model-name"
              placeholder={placeholder}
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              className="h-9 text-xs"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={hintId}
              disabled={isUploading}
            />
            {nameError ? (
              <p
                id={hintId}
                className="text-destructive flex items-center gap-1 text-[11px]"
              >
                <AlertCircle aria-hidden="true" className="h-3 w-3 shrink-0" />
                {nameError}
              </p>
            ) : (
              <p id={hintId} className="text-muted-foreground text-[11px]">
                {backend === 'llamacpp'
                  ? `org/model-name format (e.g. ${placeholder}). The quantization comes from the file name (model-Q4_K_M.gguf) unless you add it as :QUANT.`
                  : `org/model-name format (e.g. ${placeholder})`}
              </p>
            )}
          </div>

          {!isUploading && (
            <div className="space-y-1.5">
              <Label className="text-foreground text-xs font-medium">
                Model File
              </Label>
              <FileDropZone
                file={selectedFile}
                onFileChange={setSelectedFile}
                accept={acceptedMimeTypes(backend)}
                validate={validateModelFile}
                compact
                label="Drag & drop a file, or click to browse"
                hint={`${acceptedExtensions(backend)} files`}
                fileIcon={FileIcon}
                testId="upload-model-file-dropzone"
                inputTestId="upload-model-file"
              />
            </div>
          )}

          {isUploading &&
            (uploadProgress?.files ?? []).map((file, index) => {
              const percent = percentOf(file.sentBytes, file.totalBytes)
              const isCurrent = index === uploadProgress?.currentFile
              const retry = isCurrent ? uploadProgress?.retry : undefined
              return (
                <div
                  key={`${index}-${file.name}`}
                  data-testid="upload-model-progress"
                  className="bg-card space-y-2 rounded-md border p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <div className="bg-muted/50 flex h-8 w-8 shrink-0 items-center justify-center rounded">
                      <FileIcon className="text-muted-foreground h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">
                        {file.name}
                      </p>
                      <p className="text-muted-foreground text-[11px] tabular-nums">
                        {retry
                          ? `Connection lost \u2014 retrying (attempt ${retry.attempt} of ${retry.of})\u2026`
                          : `${formatBytes(file.sentBytes)} of ${formatBytes(file.totalBytes)} (${percent}%)`}
                      </p>
                    </div>
                    {isCurrent && (
                      <Loader className="text-primary h-3.5 w-3.5 shrink-0 animate-spin" />
                    )}
                  </div>
                  <Progress
                    value={percent}
                    aria-label={`Uploading ${file.name}`}
                    className="h-1.5"
                  />
                </div>
              )
            })}

          {isUploading && !uploadProgress && selectedFile && (
            <div className="bg-card flex items-center gap-2 rounded-md border p-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">
                  {selectedFile.name}
                </p>
                {pendingMessage && (
                  <p
                    data-testid="upload-model-pending"
                    className="text-muted-foreground text-[11px]"
                  >
                    {pendingMessage}
                  </p>
                )}
              </div>
              <Loader className="text-primary h-3.5 w-3.5 shrink-0 animate-spin" />
            </div>
          )}

          {uploadError && (
            <InlineNotice
              tone="destructive"
              size="sm"
              className="items-start"
              icon={
                <AlertCircle
                  aria-hidden="true"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                />
              }
            >
              {uploadError.message}
            </InlineNotice>
          )}

          {isUploadSuccess && (
            <InlineNotice
              tone="success"
              size="sm"
              role="status"
              className="items-start"
              icon={
                <CheckCircle2
                  aria-hidden="true"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                />
              }
            >
              Model uploaded successfully.
            </InlineNotice>
          )}
        </div>

        <DialogFooter>
          {isUploading ? (
            <Button
              data-testid="upload-model-cancel"
              variant="outline"
              size="sm"
              onClick={onCancelUpload}
            >
              <X className="h-3.5 w-3.5" />
              Cancel upload
            </Button>
          ) : (
            <DialogClose asChild>
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            </DialogClose>
          )}
          <Button
            data-testid="upload-model-submit"
            size="sm"
            onClick={handleUpload}
            disabled={!isValid || isUploading}
          >
            {isUploading ? (
              <Loader className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {isUploading ? 'Uploading\u2026' : 'Upload'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
