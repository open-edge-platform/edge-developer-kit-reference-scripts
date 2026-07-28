// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertCircle, File as FileIcon, Trash2, Upload } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface FileDropZoneProps {
  /** Currently selected file */
  file: File | null
  /** Called when a valid file is selected or dropped */
  onFileChange: (file: File | null) => void
  /** Comma-separated extensions for the file input accept attribute (e.g. ".wav,.mp3") */
  accept: string
  /** Custom validation function. Return an error string, or null if valid. */
  validate?: (file: File) => string | null
  /** Whether to disable interactions */
  disabled?: boolean
  /** Use compact layout (for secondary/optional upload areas) */
  compact?: boolean
  /** Custom label for the drop zone */
  label?: string
  /** Custom hint text below the label (defaults to "or click to browse (<accept>)") */
  hint?: string
  /** Whether to show the max-size hint line in default (non-compact) mode */
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
  const [isDragging, setIsDragging] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const dragCounter = useRef(0)

  const validateAndSet = useCallback(
    (f: File) => {
      if (validate) {
        const error = validate(f)
        if (error) {
          setValidationError(error)
          return
        }
      }
      setValidationError(null)
      onFileChange(f)
    },
    [onFileChange, validate],
  )

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current === 0) setIsDragging(false)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current = 0
      setIsDragging(false)
      setValidationError(null)
      const f = e.dataTransfer.files[0]
      if (f) validateAndSet(f)
    },
    [validateAndSet],
  )

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setValidationError(null)
      const f = e.target.files?.[0]
      if (f) validateAndSet(f)
      e.target.value = ''
    },
    [validateAndSet],
  )

  const handleRemove = useCallback(() => {
    setValidationError(null)
    onFileChange(null)
  }, [onFileChange])

  return (
    <div className="space-y-2">
      {!file ? (
        <div
          data-testid={testId}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            'relative cursor-pointer border-2 border-dashed text-center transition-all duration-200',
            compact ? 'rounded-lg p-6' : 'rounded-xl p-12',
            isDragging && 'border-primary bg-primary/5',
            !isDragging &&
              'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50',
            disabled && 'pointer-events-none opacity-50',
          )}
        >
          <input
            data-testid={inputTestId}
            type="file"
            accept={accept}
            onChange={handleFileInput}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            disabled={disabled}
          />
          <Upload
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
          <p
            className={cn(
              'text-muted-foreground',
              compact ? 'text-[10px]' : 'text-xs',
            )}
          >
            {hint ?? `or click to browse (${accept.replaceAll(',', ', ')})`}
          </p>
          {!compact && maxSizeHint && (
            <p className="text-muted-foreground mt-1 text-[10px]">
              {maxSizeHint}
            </p>
          )}
        </div>
      ) : (
        <>
          {showImagePreview && <ImagePreview file={file} />}
          <div
            className={cn(
              'flex items-center justify-between border-2 border-green-500 bg-green-50 dark:bg-green-950/20',
              compact ? 'rounded-lg p-3' : 'rounded-xl p-4',
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <SelectedIcon
                className={cn(
                  'flex-shrink-0 text-green-600 dark:text-green-400',
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
                <p
                  className={cn(
                    'text-muted-foreground',
                    compact ? 'text-[10px]' : 'text-xs',
                  )}
                >
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            </div>
            {!disabled && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRemove}
                className="flex-shrink-0 hover:bg-red-100 dark:hover:bg-red-950"
                title="Remove file"
              >
                <Trash2
                  className={cn(
                    'text-red-600 dark:text-red-400',
                    compact ? 'h-4 w-4' : 'h-5 w-5',
                  )}
                />
              </Button>
            )}
          </div>
        </>
      )}

      {validationError && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-lg border p-3">
          <p className="flex items-center gap-2 text-xs font-medium">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            {validationError}
          </p>
        </div>
      )}
    </div>
  )
}
