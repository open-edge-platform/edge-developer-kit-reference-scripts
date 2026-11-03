// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useRef,
  useState,
} from 'react'
import { cn } from '@/lib/utils'

interface FileDropTargetProps {
  /** Receives the dropped or picked files; never called with an empty list. */
  onFiles: (files: File[]) => void
  /** Value for the file input's `accept` attribute. */
  accept?: string
  multiple?: boolean
  disabled?: boolean
  /** Padding, radius and any other frame styling. */
  className?: string
  /** What the target shows: icon, label, hint. */
  children: ReactNode
  'aria-label'?: string
  /** Id of the element explaining a problem with the last pick. */
  'aria-describedby'?: string
  /** data-testid for the target. */
  testId?: string
  /** data-testid for the hidden input, for setting files in tests. */
  inputTestId?: string
}

/**
 * A dashed drop target that also opens the picker on click or Enter/Space. Drag depth is counted
 * because `dragleave` fires on every child crossing; validation stays with the caller.
 */
export function FileDropTarget({
  onFiles,
  accept,
  multiple = false,
  disabled = false,
  className,
  children,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  testId,
  inputTestId,
}: FileDropTargetProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [isDragging, setIsDragging] = useState(false)

  const emit = (list: FileList | null) => {
    const files = Array.from(list ?? [])
    if (files.length === 0) return
    onFiles(multiple ? files : files.slice(0, 1))
  }

  const stop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const openPicker = () => {
    if (!disabled) inputRef.current?.click()
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      data-testid={testId}
      data-dragging={isDragging || undefined}
      onClick={openPicker}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openPicker()
        }
      }}
      onDragEnter={(e) => {
        stop(e)
        dragDepth.current++
        setIsDragging(true)
      }}
      onDragOver={stop}
      onDragLeave={(e) => {
        stop(e)
        dragDepth.current--
        if (dragDepth.current === 0) setIsDragging(false)
      }}
      onDrop={(e) => {
        stop(e)
        dragDepth.current = 0
        setIsDragging(false)
        if (!disabled) emit(e.dataTransfer.files)
      }}
      className={cn(
        'focus-visible:ring-ring/50 cursor-pointer border-2 border-dashed text-center transition-colors outline-none focus-visible:ring-[3px]',
        isDragging
          ? 'border-primary bg-primary/5'
          : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        data-testid={inputTestId}
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          emit(e.target.files)
          // Allow picking the same file again.
          e.target.value = ''
        }}
      />
      {children}
    </div>
  )
}
