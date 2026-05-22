// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { FileAudio } from 'lucide-react'
import { useCallback } from 'react'
import { FileDropZone } from '@/components/common/file-drop-zone'

const MAX_AUDIO_SIZE_BYTES = 50 * 1024 * 1024
const AUDIO_EXTENSIONS = '.wav,.mp3,.flac,.ogg,.webm,.m4a,.aac,.wma'

interface AudioDropZoneProps {
  /** Currently selected file */
  file: File | null
  /** Called when a valid file is selected or dropped */
  onFileChange: (file: File | null) => void
  /** Whether to disable interactions */
  disabled?: boolean
  /** Use compact layout (for secondary/optional upload areas) */
  compact?: boolean
  /** Custom label for the drop zone (defaults to "Drop your audio file here") */
  label?: string
  /** Custom hint text below the label */
  hint?: string
}

function validateAudio(file: File): string | null {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  const allowedExts = AUDIO_EXTENSIONS.split(',')
  if (!file.type.startsWith('audio/') && !allowedExts.includes(ext)) {
    return 'Please select a valid audio file (WAV, MP3, FLAC, OGG, etc.)'
  }
  if (file.size > MAX_AUDIO_SIZE_BYTES) {
    return 'File size must be less than 50 MB'
  }
  return null
}

export function AudioDropZone({
  file,
  onFileChange,
  disabled,
  compact,
  label = 'Drop your audio file here',
  hint,
}: AudioDropZoneProps) {
  const validate = useCallback((f: File) => validateAudio(f), [])

  return (
    <FileDropZone
      file={file}
      onFileChange={onFileChange}
      accept={AUDIO_EXTENSIONS}
      validate={validate}
      disabled={disabled}
      compact={compact}
      label={label}
      hint={hint}
      maxSizeHint="Maximum file size: 50 MB"
      fileIcon={FileAudio}
    />
  )
}
