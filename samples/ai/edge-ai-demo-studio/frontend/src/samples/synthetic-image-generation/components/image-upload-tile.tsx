// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Upload, X } from 'lucide-react'
import NextImage from 'next/image'
import { type ChangeEvent, useRef } from 'react'
import { toast } from 'sonner'
import { readFileAsDataUrl, validateImageFile } from '@/lib/browser/image-utils'
import { cn } from '@/lib/utils'

interface ImageUploadTileProps {
  label: string
  /** Placeholder text shown over the icon before an image is picked. */
  placeholder: string
  image: string | null
  onChange: (dataUrl: string) => void
  onClear: () => void
  /** Optional caption shown below the tile. */
  hint?: string
  inputId: string
}

/** A square drop-style tile: click to pick an image, preview it, clear it. */
export function ImageUploadTile({
  label,
  placeholder,
  image,
  onChange,
  onClear,
  hint,
  inputId,
}: ImageUploadTileProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const problem = validateImageFile(file)
    if (problem) {
      toast.error(problem)
      e.target.value = ''
      return
    }
    readFileAsDataUrl(file)
      .then(onChange)
      .catch(() => toast.error('Could not read the image'))
  }

  const clear = () => {
    onClear()
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div>
      <label
        htmlFor={inputId}
        className="text-muted-foreground mb-2 block text-xs font-bold uppercase"
      >
        {label}
      </label>
      <div
        className={cn(
          'group relative aspect-square overflow-hidden rounded-xl border-2 border-dashed transition-all duration-300',
          image ? 'border-primary/50' : 'border-border hover:border-primary/50',
        )}
      >
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          aria-label={image ? `Replace ${label}` : `Choose ${label}`}
          className="focus-visible:ring-ring/50 absolute inset-0 cursor-pointer outline-none focus-visible:ring-[3px]"
        >
          {image ? (
            <NextImage
              src={image}
              className="object-cover"
              alt=""
              fill
              unoptimized
            />
          ) : (
            <span className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-2">
              <Upload
                className="group-hover:text-foreground h-6 w-6 transition-colors"
                aria-hidden
              />
              <span className="text-center text-xs font-medium">
                {placeholder}
              </span>
            </span>
          )}
        </button>
        {image && (
          <button
            type="button"
            onClick={clear}
            aria-label={`Remove ${label}`}
            className="absolute top-2 right-2 rounded-full bg-black/50 p-1 text-white transition-colors hover:bg-black/70"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        )}
      </div>
      <input
        id={inputId}
        type="file"
        ref={inputRef}
        onChange={handleChange}
        accept="image/*"
        className="hidden"
      />
      {hint && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
    </div>
  )
}
