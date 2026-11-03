// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertCircle, File as FileIcon, Trash2, Upload } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { TONES } from '@/components/common/tones'
import { Button } from '@/components/ui/button'
import { formatBytes } from '@/lib/browser/format'
import { cn } from '@/lib/utils'
import { FileDropTarget } from './file-drop-target'

interface FileDropZoneProps {
  file: File | null
  /** Called when a valid file is selected or dropped */
  onFileChange: (file: File | null) => void
  /** Comma-separated extensions for the file input accept attribute (e.g. ".wav,.mp3") */
  accept: string
  /** Returns an error string, or null if valid. */
  validate?: (file: File) => string | null
  disabled?: boolean
  /** Use compact layout (for secondary/optional upload areas) */
  compact?: boolean
  label?: string
  /** Hint text below the label (defaults to "or click to browse (<accept>)") */
  hint?: string
  /** Max-size hint line, shown only in the non-compact layout */
  maxSizeHint?: string
  /** Icon shown next to the selected filename (defaults to generic File icon) */
  fileIcon?: LucideIcon
  /** Render an image thumbnail of the selected file above the filename card. */
  showImagePreview?: boolean
  /** data-testid for the outer drop zone container */
  testId?: string
  /** data-testid for the hidden file input (useful for programmatic file setting in tests) */
  inputTestId?: string
}

function ImagePreview({ file }: { file: File }) {
  const imgRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    const img = imgRef.current
    if (!img) return
    const objectUrl = URL.createObjectURL(file)
    img.src = objectUrl
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  return (
    <div className="bg-muted/30 overflow-hidden rounded-xl border">
      {/* eslint-disable-next-line @next/next/no-img-element -- src is an object URL assigned imperatively via ref (Strict Mode-safe revocation); next/image requires a src prop and optimizes nothing for local blobs */}
      <img
        ref={imgRef}
        alt={file.name}
        className="mx-auto object-contain"
        style={{ maxHeight: '16rem', width: 'auto' }}
      />
    </div>
  )
}

export function FileDropZone({
  file,
  onFileChange,
  accept,
  validate,
  disabled,
  compact,
  label = 'Drop your file here',
  hint,
  maxSizeHint,
  fileIcon: SelectedIcon = FileIcon,
  showImagePreview,
  testId,
  inputTestId,
}: FileDropZoneProps) {
  const [validationError, setValidationError] = useState<string | null>(null)
  const errorId = useId()

  const handleFiles = ([f]: File[]) => {
    const error = validate?.(f) ?? null
    setValidationError(error)
    if (!error) onFileChange(f)
  }

  const handleRemove = () => {
    setValidationError(null)
    onFileChange(null)
  }

  return (
    <div className="space-y-2">
      {!file ? (
        <FileDropTarget
          onFiles={handleFiles}
          accept={accept}
          disabled={disabled}
          testId={testId}
          inputTestId={inputTestId}
          aria-label={label}
          aria-describedby={validationError ? errorId : undefined}
          className={compact ? 'rounded-lg p-6' : 'rounded-xl p-12'}
        >
          <Upload
            aria-hidden="true"
            className={cn(
              'text-muted-foreground mx-auto mb-3',
              compact ? 'h-6 w-6' : 'h-10 w-10',
            )}
          />
          <p
            className={cn('font-medium', compact ? 'text-xs' : 'mb-1 text-sm')}
          >
            {label}
          </p>
          <p className="text-muted-foreground text-xs">
            {hint ?? `or click to browse (${accept.replaceAll(',', ', ')})`}
          </p>
          {!compact && maxSizeHint && (
            <p className="text-muted-foreground mt-1 text-xs">{maxSizeHint}</p>
          )}
        </FileDropTarget>
      ) : (
        <>
          {showImagePreview && <ImagePreview file={file} />}
          <div
            className={cn(
              'flex items-center justify-between border-2',
              TONES.success.surface,
              'border-success/60',
              compact ? 'rounded-lg p-3' : 'rounded-xl p-4',
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <SelectedIcon
                aria-hidden="true"
                className={cn(
                  'text-success flex-shrink-0',
                  compact ? 'h-5 w-5' : 'h-8 w-8',
                )}
              />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'text-foreground truncate font-medium',
                    compact ? 'text-xs' : 'text-sm',
                  )}
                >
                  {file.name}
                </p>
                <p className="text-muted-foreground text-xs">
                  {formatBytes(file.size)}
                </p>
              </div>
            </div>
            {!disabled && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleRemove}
                className="hover:bg-destructive/10 flex-shrink-0"
                aria-label={`Remove ${file.name}`}
                title="Remove file"
              >
                <Trash2
                  aria-hidden="true"
                  className={cn(
                    'text-destructive',
                    compact ? 'h-4 w-4' : 'h-5 w-5',
                  )}
                />
              </Button>
            )}
          </div>
        </>
      )}

      {validationError && (
        <div
          id={errorId}
          role="alert"
          className={cn('rounded-lg border p-3', TONES.destructive.surface)}
        >
          <p
            className={cn(
              'flex items-center gap-2 text-xs font-medium',
              TONES.destructive.strongText,
            )}
          >
            <AlertCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            {validationError}
          </p>
        </div>
      )}
    </div>
  )
}
