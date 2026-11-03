// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ImagePlus, X } from 'lucide-react'
import Image from 'next/image'
import { UploadButton } from '@/components/common/upload-button'
import { MEDIA_SRC_CHARS, safeMediaSrc } from '@/lib/validation'
import type { ChatAttachments } from '../lib/chat-helpers'

const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif'

/** Toolbar "Image" button: picks images to attach to the draft message. */
export function ImageAttachButton({
  onFiles,
  disabled,
}: {
  onFiles: (files: File[]) => void
  disabled?: boolean
}) {
  return (
    <UploadButton
      accept={ACCEPTED_IMAGE_TYPES}
      multiple
      onFiles={onFiles}
      disabled={disabled}
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-foreground h-7 gap-1.5 px-2 text-xs"
    >
      <ImagePlus aria-hidden className="h-3.5 w-3.5" />
      Image
    </UploadButton>
  )
}

/** Thumbnails of the images attached to the draft, each with a remove button. */
export function ImageAttachPreviewList({
  attachments,
}: {
  attachments: ChatAttachments
}) {
  const { previews, remove } = attachments
  if (previews.length === 0) return null
  return (
    <ul aria-label="Attached images" className="mb-2 flex flex-wrap gap-2">
      {/* Each preview is an object URL of its own: unique per attachment. */}
      {previews.map((preview, i) => {
        let src = ''
        for (const ch of safeMediaSrc(preview)) {
          let ok = ''
          for (const allowed of MEDIA_SRC_CHARS)
            if (allowed === ch) {
              ok = allowed
              break
            }
          if (!ok) {
            src = ''
            break
          }
          src += ok
        }
        return (
          <li key={preview} className="relative inline-block">
            {src && (
              <Image
                src={src}
                alt={`Attached image ${i + 1}`}
                width={64}
                height={64}
                className="border-border h-16 w-16 rounded-lg border object-cover"
                unoptimized
              />
            )}
            <button
              type="button"
              aria-label={`Remove attached image ${i + 1}`}
              className="bg-destructive text-destructive-foreground absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full"
              onClick={() => remove(i)}
            >
              <X aria-hidden className="h-3 w-3" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
