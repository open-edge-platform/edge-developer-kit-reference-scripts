// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { type ComponentProps, type ReactNode, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface UploadButtonProps {
  /** Comma-separated accept attribute (e.g. "audio/*" or ".png,.jpg"). */
  accept: string
  /** Called with the picked file(s). Never called with an empty list. */
  onFiles: (files: File[]) => void
  multiple?: boolean
  children: ReactNode
  /** Refuses to open the picker; `aria-disabled`, not `disabled`, so keyboard focus stays put. */
  disabled?: boolean
  /** Reset the input value after selection so the same file can be re-picked. */
  resetOnSelect?: boolean
  variant?: ComponentProps<typeof Button>['variant']
  size?: ComponentProps<typeof Button>['size']
  className?: string
  /** Tooltip; names the button only when nothing else does (icon-only: set it or `aria-label`). */
  title?: string
  'aria-label'?: string
  /** data-testid for the hidden input (useful for tests to set files). */
  inputTestId?: string
}

/** A `<button>` driving a hidden file input, for inline uploads; drop areas use FileDropZone. */
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
  'aria-label': ariaLabel,
  inputTestId,
}: UploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={cn(
          'aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
          className,
        )}
        title={title}
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (!disabled) inputRef.current?.click()
        }}
      >
        {children}
      </Button>
      <input
        ref={inputRef}
        data-testid={inputTestId}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length) onFiles(files)
          if (resetOnSelect) e.target.value = ''
        }}
      />
    </>
  )
}
