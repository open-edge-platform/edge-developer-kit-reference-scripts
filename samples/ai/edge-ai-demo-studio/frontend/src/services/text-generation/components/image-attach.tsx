// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ImagePlus, X } from 'lucide-react'
import Image from 'next/image'
import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { useImagePreviewUrl } from '@/hooks/use-image-preview-url'

const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif'

interface ImageAttachButtonProps {
  onSelect?: (e: React.ChangeEvent<HTMLInputElement>) => void
  disabled?: boolean
  accept?: string
  multiple?: boolean
}

/**
 * Toolbar "Image" button paired with a hidden file input, for attaching
 * images to a chat message. Drop into ConversationPanel's `toolbarExtra`.
 */
export function ImageAttachButton({
  onSelect,
  disabled,
  accept = ACCEPTED_IMAGE_TYPES,
  multiple = true,
}: ImageAttachButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onClick={(e) => {
          ;(e.target as HTMLInputElement).value = ''
        }}
        onChange={onSelect}
      />
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground h-7 gap-1.5 px-2 text-xs"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled}
      >
        <ImagePlus className="h-3.5 w-3.5" />
        Image
      </Button>
    </>
  )
}

interface ImageAttachPreviewProps {
  url: string
  onRemove?: () => void
}

export function ImageAttachPreview({ url, onRemove }: ImageAttachPreviewProps) {
  const { previewUrl } = useImagePreviewUrl(url)
  return (
    previewUrl && (
      <div className="relative inline-block">
        <Image
          src={previewUrl}
          alt="Attached"
          width={64}
          height={64}
          className="border-border h-16 w-16 rounded-lg border object-cover"
          unoptimized
        />
        <button
          type="button"
          className="bg-destructive absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full"
          onClick={onRemove}
        >
          <X className="text-destructive-foreground h-3 w-3" />
        </button>
      </div>
    )
  )
}

interface ImageAttachPreviewListProps {
  srcs: string[]
  onRemove?: (index: number) => void
}

export function ImageAttachPreviewList({
  srcs,
  onRemove,
}: ImageAttachPreviewListProps) {
  if (srcs.length === 0) return null
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {srcs.map((src, i) => (
        <ImageAttachPreview
          key={`${i}-${src.slice(-20)}`}
          url={src}
          onRemove={onRemove ? () => onRemove(i) : undefined}
        />
      ))}
    </div>
  )
}
