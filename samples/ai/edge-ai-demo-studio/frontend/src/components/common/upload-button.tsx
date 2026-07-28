// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { ComponentProps, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface UploadButtonProps {
  /** Comma-separated accept attribute (e.g. "audio/*" or ".png,.jpg"). */
  accept: string
  /** Called with the picked file(s). Never called with an empty list. */
  onFiles: (files: File[]) => void
  /** Allow selecting more than one file. */
  multiple?: boolean
  /** Button label content (icon + text). */
  children: ReactNode
  disabled?: boolean
  /** Reset the input value after selection so the same file can be re-picked. */
  resetOnSelect?: boolean
  variant?: ComponentProps<typeof Button>['variant']
  size?: ComponentProps<typeof Button>['size']
  className?: string
  /** Tooltip / accessible label (useful for icon-only buttons). */
  title?: string
  /** data-testid for the hidden input (useful for tests to set files). */
  inputTestId?: string
}

/**
 * Compact file picker rendered as a button (hidden `<input type="file">` wrapped
 * in a `<label>`). Use this for inline "Upload" buttons; for a drop area use
 * FileDropZone / ImageDropZone / AudioDropZone instead.
 */
export function UploadButton({
  accept,
  onFiles,
  multiple = false,
  children,
  disabled,
  resetOnSelect = true,
  variant = 'outline',
  size,
  className,
  title,
  inputTestId,
}: UploadButtonProps) {
  return (
    <Button
      asChild
      variant={variant}
      size={size}
      disabled={disabled}
      className={className}
      title={title}
    >
      <label
        className={cn(
          'cursor-pointer',
          disabled && 'pointer-events-none cursor-not-allowed',
        )}
      >
        {children}
        <input
          data-testid={inputTestId}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length) onFiles(files)
            if (resetOnSelect) e.target.value = ''
          }}
        />
      </label>
    </Button>
  )
}
