// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertCircle, Upload, Video, X } from 'lucide-react'
import { useId, useState } from 'react'
import { FileDropTarget } from '@/components/common/file-drop-target'
import { RefVideo } from '@/components/common/ref-media'
import { TONES } from '@/components/common/tones'
import { Button } from '@/components/ui/button'
import { useObjectUrl } from '@/hooks/use-object-url'
import { formatBytes } from '@/lib/browser/format'
import { cn } from '@/lib/utils'
import { MEDIA_SRC_CHARS, safeMediaSrc } from '@/lib/validation'

/** The video formats the pickers accept, by MIME type and extension. */
const VIDEO_ACCEPT =
  'video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.mov,.mkv,.webm'

/**
 * The problem with a picked or dropped video, or `null`: its type or extension must be in `accept`
 * (a drop skips the picker's filter) and its size within `maxSizeMb`.
 */
function validateVideoFile(
  file: File,
  {
    accept = VIDEO_ACCEPT,
    maxSizeMb,
  }: { accept?: string; maxSizeMb?: number } = {},
): string | null {
  const allowed = accept
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
  const dot = file.name.lastIndexOf('.')
  const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : ''
  const type = file.type.toLowerCase()
  const typeOk = allowed.some(
    (entry) =>
      entry === type ||
      (extension !== '' && entry === extension) ||
      (entry.endsWith('/*') && type.startsWith(entry.slice(0, -1))),
  )
  if (!typeOk) {
    return `${file.name} is not a supported video${type ? ` (${type})` : ''}.`
  }
  if (maxSizeMb !== undefined && file.size > maxSizeMb * 1024 * 1024) {
    return `The video is larger than ${maxSizeMb} MB.`
  }
  return null
}

export interface VideoFilePickerProps {
  file: File | null
  /** Called with a valid picked or dropped video, or `null` when removed. */
  onFileChange: (file: File | null) => void
  /** `accept` attribute and validation list; defaults to {@link VIDEO_ACCEPT}. */
  accept?: string
  maxSizeMb?: number
  /** Drop-area heading. */
  label?: string
  /** The accepted formats in words, under the heading. */
  formatsHint?: string
  /** No picking (e.g. while a job runs). */
  disabled?: boolean
  /** Keeps the chosen video (e.g. while it uploads); picking stays possible. */
  removeDisabled?: boolean
  /** Classes of the preview `<video>`, e.g. its maximum height. */
  previewClassName?: string
  testId?: string
  inputTestId?: string
}

/** Picks, validates and previews one video; it owns the preview's object URL, not the caller. */
export function VideoFilePicker({
  file,
  onFileChange,
  accept = VIDEO_ACCEPT,
  maxSizeMb,
  label = 'Choose a video',
  formatsHint = 'MP4, MOV, MKV or WEBM',
  disabled = false,
  removeDisabled = false,
  previewClassName,
  testId,
  inputTestId,
}: VideoFilePickerProps) {
  const [error, setError] = useState<string | null>(null)
  const errorId = useId()
  const previewUrl = useObjectUrl(file)
  let safePreviewUrl = ''
  for (const ch of safeMediaSrc(previewUrl)) {
    let ok = ''
    for (const allowed of MEDIA_SRC_CHARS)
      if (allowed === ch) {
        ok = allowed
        break
      }
    if (!ok) {
      safePreviewUrl = ''
      break
    }
    safePreviewUrl += ok
  }

  const handleFiles = ([picked]: File[]) => {
    const problem = validateVideoFile(picked, { accept, maxSizeMb })
    setError(problem)
    if (!problem) onFileChange(picked)
  }

  if (file) {
    return (
      <div
        className={cn('space-y-3 rounded-lg border p-3', TONES.primary.surface)}
        data-testid={testId}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Video
              aria-hidden="true"
              className="text-primary h-4 w-4 shrink-0"
            />
            <span className="truncate text-sm font-medium">{file.name}</span>
            <span className="text-muted-foreground shrink-0 text-xs">
              ({formatBytes(file.size)})
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            onClick={() => onFileChange(null)}
            disabled={removeDisabled}
            aria-label={`Remove ${file.name}`}
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </Button>
        </div>
        {safePreviewUrl && (
          <RefVideo
            src={safePreviewUrl}
            className={cn(
              'bg-muted/50 mx-auto max-h-64 w-auto max-w-full rounded-md object-contain',
              previewClassName,
            )}
          />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <FileDropTarget
        onFiles={handleFiles}
        accept={accept}
        disabled={disabled}
        aria-label={label}
        aria-describedby={error ? errorId : undefined}
        testId={testId}
        inputTestId={inputTestId}
        className="rounded-lg px-6 py-10"
      >
        <Upload
          aria-hidden="true"
          className="text-muted-foreground mx-auto h-6 w-6"
        />
        <p className="text-foreground mt-2 text-sm font-medium">{label}</p>
        <p className="text-muted-foreground text-xs">
          Drop it here or click to browse · {formatsHint}
          {maxSizeMb !== undefined && ` · up to ${maxSizeMb} MB`}
        </p>
      </FileDropTarget>
      {error && (
        <p
          id={errorId}
          role="alert"
          className={cn(
            'flex items-center gap-1.5 text-xs',
            TONES.destructive.strongText,
          )}
        >
          <AlertCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}
