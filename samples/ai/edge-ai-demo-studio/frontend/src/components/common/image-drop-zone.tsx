// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { FileImage } from 'lucide-react'
import { useCallback } from 'react'
import { FileDropZone } from '@/components/common/file-drop-zone'

const DEFAULT_IMAGE_EXTENSIONS =
  'image/jpeg,image/png,image/bmp,image/tiff,image/webp'
const DEFAULT_MAX_IMAGE_MB = 10

interface ImageDropZoneProps {
  /** Currently selected file */
  file: File | null
  /** Called when a valid image is selected or dropped */
  onFileChange: (file: File | null) => void
  /** Accepted image types (defaults to common raster formats) */
  accept?: string
  /** Maximum file size in MB (defaults to 10) */
  maxSizeMb?: number
  /** Whether to disable interactions */
  disabled?: boolean
  /** Use compact layout (for secondary/optional upload areas) */
  compact?: boolean
  /** Custom label for the drop zone (defaults to "Drop your image here") */
  label?: string
  /** Custom hint text below the label */
  hint?: string
  testId?: string
  inputTestId?: string
}

/**
 * Image-specific drop zone: wraps FileDropZone with image validation and an
 * inline thumbnail preview of the selected file.
 */
export function ImageDropZone({
  file,
  onFileChange,
  accept = DEFAULT_IMAGE_EXTENSIONS,
  maxSizeMb = DEFAULT_MAX_IMAGE_MB,
  disabled,
  compact,
  label = 'Drop your image here',
  hint,
  testId,
  inputTestId,
}: ImageDropZoneProps) {
  const validate = useCallback(
    (f: File): string | null => {
      const allowed = accept.split(',').map((t) => t.trim())
      const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase()
      const typeOk =
        f.type.startsWith('image/') ||
        allowed.includes(f.type) ||
        allowed.includes(ext)
      if (!typeOk) {
        return 'Please select a valid image file (JPG, PNG, BMP, TIFF, WEBP)'
      }
      if (f.size > maxSizeMb * 1024 * 1024) {
        return `File size must be less than ${maxSizeMb} MB`
      }
      return null
    },
    [accept, maxSizeMb],
  )

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
      maxSizeHint={`Maximum file size: ${maxSizeMb} MB`}
      fileIcon={FileImage}
      showImagePreview
      testId={testId}
      inputTestId={inputTestId}
    />
  )
}
