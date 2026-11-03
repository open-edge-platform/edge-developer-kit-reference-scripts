// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { FileAudio } from 'lucide-react'
import { FileDropZone } from '@/components/common/file-drop-zone'

const MAX_AUDIO_SIZE_BYTES = 50 * 1024 * 1024
const AUDIO_EXTENSIONS = '.wav,.mp3,.flac,.ogg,.webm,.m4a,.aac,.wma'

interface AudioDropZoneProps {
  file: File | null
  /** Called when a valid file is selected or dropped. */
  onFileChange: (file: File | null) => void
  /** Restrict accepted extensions (defaults to a broad audio set). */
  accept?: string
  /** Validate by extension only; by default any audio/* MIME type is accepted too. */
  strictExtensions?: boolean
  disabled?: boolean
  /** Compact layout, for secondary or optional uploads. */
  compact?: boolean
  label?: string
  /** Hint text below the label. */
  hint?: string
  /** Test id of the hidden file input, for setting files in tests. */
  inputTestId?: string
}

function validateAudio(
  file: File,
  accept: string,
  strict: boolean,
): string | null {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  const allowedExts = accept.split(',').map((e) => e.trim().toLowerCase())
  const extOk = allowedExts.includes(ext)
  const ok = strict ? extOk : extOk || file.type.startsWith('audio/')
  if (!ok) {
    const pretty = allowedExts
      .map((e) => e.replace('.', '').toUpperCase())
      .join(', ')
    return `Please select a valid audio file (${pretty})`
  }
  if (file.size > MAX_AUDIO_SIZE_BYTES) {
    return 'File size must be less than 50 MB'
  }
  return null
}

export function AudioDropZone({
  file,
  onFileChange,
  accept = AUDIO_EXTENSIONS,
  strictExtensions = false,
  disabled,
  compact,
  label = 'Drop your audio file here',
  hint,
  inputTestId,
}: AudioDropZoneProps) {
  const validate = (f: File) => validateAudio(f, accept, strictExtensions)

  return (
    <FileDropZone
      file={file}
      onFileChange={onFileChange}
      accept={accept}
      validate={validate}
      disabled={disabled}
      compact={compact}
      label={label}
      hint={hint}
      maxSizeHint="Maximum file size: 50 MB"
      fileIcon={FileAudio}
      inputTestId={inputTestId}
    />
  )
}
