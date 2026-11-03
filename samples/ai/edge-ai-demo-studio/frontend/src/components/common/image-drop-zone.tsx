// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { FileImage } from 'lucide-react'
import { FileDropZone } from '@/components/common/file-drop-zone'
import {
  IMAGE_ACCEPT,
  MAX_IMAGE_MB,
  validateImageFile,
} from '@/lib/browser/image-utils'

interface ImageDropZoneProps {
  file: File | null
  /** Called when a valid image is selected or dropped */
  onFileChange: (file: File | null) => void
  /** Accepted image types (defaults to `IMAGE_ACCEPT`, the common raster formats) */
  accept?: string
  /** Maximum file size in MB (defaults to `MAX_IMAGE_MB`) */
  maxSizeMb?: number
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

/** FileDropZone with the shared image validation and a thumbnail of the selected file. */
export function ImageDropZone({
  file,
  onFileChange,
  accept = IMAGE_ACCEPT,
  maxSizeMb = MAX_IMAGE_MB,
  disabled,
  compact,
  label = 'Drop your image here',
  hint,
  testId,
  inputTestId,
}: ImageDropZoneProps) {
  return (
    <FileDropZone
      file={file}
      onFileChange={onFileChange}
      accept={accept}
      validate={(f) => validateImageFile(f, { accept, maxSizeMb })}
      disabled={disabled}
      compact={compact}
      label={label}
      hint={hint ?? 'or click to browse (JPG, PNG, BMP, TIFF, WEBP)'}
      maxSizeHint={`Maximum file size: ${maxSizeMb} MB`}
      fileIcon={FileImage}
      showImagePreview
      testId={testId}
      inputTestId={inputTestId}
    />
  )
}
