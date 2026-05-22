// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  AlertCircle,
  CheckCircle2,
  File,
  FileArchive,
  Loader2,
  Upload,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { FileDropZone } from '@/components/common/file-drop-zone'
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
import type { BackendId } from '@/engines/multiserve/types'
import { validateModelName } from '@/engines/multiserve/validation'

function acceptedExtensions(backend: BackendId): string {
  return backend === 'llamacpp' ? '.gguf' : '.zip'
}

function acceptedMimeTypes(backend: BackendId): string {
  return backend === 'llamacpp'
    ? '.gguf,application/octet-stream'
    : '.zip,application/zip'
}

interface UploadModelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  serviceId: string
  backend: BackendId
  taskType: string
  onUpload: (params: {
    backend: BackendId
    repoId: string
    task: string
    files: File[]
  }) => void
  isUploading: boolean
  isUploadSuccess: boolean
  uploadError: Error | null
}

export function UploadModelDialog({
  open,
  onOpenChange,
  backend,
  taskType,
  onUpload,
  isUploading,
  isUploadSuccess,
  uploadError,
}: UploadModelDialogProps) {
  const [modelName, setModelName] = useState('')
  const [selectedFile, setSelectedFile] = useState<globalThis.File | null>(null)

  const nameError = useMemo(() => {
    if (!modelName.trim()) return ''
    if (!validateModelName(modelName, backend)) {
      return backend === 'llamacpp'
        ? 'Must contain "GGUF" and follow org/model format.'
        : 'Must follow org/model format (e.g. OpenVINO/model-name).'
    }
    return ''
  }, [modelName, backend])

  const validateModelFile = useCallback(
    (file: File) => {
      const ext = acceptedExtensions(backend)
      if (!file.name.toLowerCase().endsWith(ext)) {
        return `Only ${ext} files are accepted for ${backend}.`
      }
      return null
    },
    [backend],
  )

  const isValid =
    modelName.trim().length > 0 && !nameError && selectedFile !== null

  const handleUpload = useCallback(() => {
    if (!isValid || !selectedFile) return
    onUpload({
      backend,
      repoId: modelName,
      task: taskType,
      files: [selectedFile],
    })
  }, [isValid, selectedFile, onUpload, backend, modelName, taskType])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && !isUploading) {
        setModelName('')
        setSelectedFile(null)
      }
      onOpenChange(nextOpen)
    },
    [isUploading, onOpenChange],
  )

  const placeholder =
    backend === 'llamacpp'
      ? 'Qwen/Qwen3-4B-GGUF:Q5_0'
      : 'my-org/my-custom-model'

  const FileIcon = backend === 'llamacpp' ? File : FileArchive

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
              className={`h-9 text-xs ${nameError ? 'border-red-500' : ''}`}
              disabled={isUploading}
            />
            {nameError ? (
              <p className="flex items-center gap-1 text-[11px] text-red-500">
                <AlertCircle className="h-3 w-3 shrink-0" />
                {nameError}
              </p>
            ) : (
              <p className="text-muted-foreground text-[11px]">
                org/model-name format (e.g. {placeholder})
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

          {isUploading && selectedFile && (
            <div className="bg-card space-y-2 rounded-md border p-2.5">
              <div className="flex items-center gap-2">
                <div className="bg-muted/50 flex h-8 w-8 shrink-0 items-center justify-center rounded">
                  <FileIcon className="text-muted-foreground h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">
                    {selectedFile.name}
                  </p>
                  <p className="text-muted-foreground text-[11px]">
                    Uploading&hellip;
                  </p>
                </div>
                <Loader2 className="text-primary h-3.5 w-3.5 shrink-0 animate-spin" />
              </div>
              <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                <div className="bg-primary h-full w-2/3 animate-pulse rounded-full" />
              </div>
            </div>
          )}

          {uploadError && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 dark:border-red-900 dark:bg-red-950">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
              <p className="text-xs text-red-700 dark:text-red-300">
                {uploadError.message}
              </p>
            </div>
          )}

          {isUploadSuccess && (
            <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-2.5 dark:border-green-900 dark:bg-green-950">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
              <p className="text-xs text-green-700 dark:text-green-300">
                Model uploaded successfully.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm" disabled={isUploading}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            data-testid="upload-model-submit"
            size="sm"
            onClick={handleUpload}
            disabled={!isValid || isUploading}
          >
            {isUploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
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
