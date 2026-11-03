// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { FileText, Loader, Upload } from 'lucide-react'
import { FileDropZone } from '@/components/common/file-drop-zone'
import { Button } from '@/components/ui/button'

interface TranslationUploadProps {
  file: File | null
  onFileChange: (file: File | null) => void
  /** Why starting is not possible right now, if it is not. */
  blockedReason?: string
  isUploading?: boolean
  model: string
  onStart: () => void
}

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024

/** The actual rules the worker enforces, shown as the limits under the drop zone. */
const ACCEPTED_EXTENSIONS = ['.pptx', '.ppt']
const MAX_FILE_SIZE_LABEL = '50 MB'

function validatePptFile(file: File): string | null {
  const name = file.name.toLowerCase()
  if (!ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return 'Please select a PowerPoint file (.pptx or .ppt)'
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `File size must be less than ${MAX_FILE_SIZE_LABEL}`
  }
  return null
}

/** Drop zone plus the one button that starts the job; the caller keeps the file. */
export function TranslationUpload({
  file,
  onFileChange,
  blockedReason,
  isUploading = false,
  model,
  onStart,
}: TranslationUploadProps) {
  const disabled = Boolean(blockedReason) || isUploading

  return (
    <div className="space-y-4">
      <FileDropZone
        file={file}
        onFileChange={onFileChange}
        accept={ACCEPTED_EXTENSIONS.join(',')}
        validate={validatePptFile}
        disabled={disabled}
        label="Drop your PowerPoint file here"
        hint={`or click to browse (${ACCEPTED_EXTENSIONS.join(', ')})`}
        maxSizeHint={`Maximum file size: ${MAX_FILE_SIZE_LABEL}`}
        fileIcon={FileText}
        testId="file-upload-area"
        inputTestId="file-input"
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          data-testid="start-translation-button"
          onClick={onStart}
          disabled={!file || disabled}
          aria-busy={isUploading || undefined}
          size="lg"
          className="gap-2"
        >
          {isUploading ? (
            <Loader className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="h-4 w-4" aria-hidden />
          )}
          <span className="stable-label">
            <span className={isUploading ? 'invisible' : undefined}>
              Start translation
            </span>
            <span className={isUploading ? undefined : 'invisible'}>
              Uploading…
            </span>
          </span>
        </Button>
        {blockedReason && (
          <p className="text-warning text-xs">{blockedReason}</p>
        )}
      </div>

      <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <li>Formats: {ACCEPTED_EXTENSIONS.join(', ')}</li>
        <li>Up to {MAX_FILE_SIZE_LABEL}</li>
        <li>Slide formatting is preserved</li>
        <li>Model: {model}</li>
      </ul>
    </div>
  )
}
