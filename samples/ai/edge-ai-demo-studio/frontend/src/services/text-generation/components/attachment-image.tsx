// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import Image from 'next/image'
import { cn } from '@/lib/utils'
import { MEDIA_SRC_CHARS, safeMediaSrc } from '@/lib/validation'

/** An image sent with a message, shown in the conversation. Omitted if `src` is not a safe media URL. */
export function AttachmentImage({
  src: rawSrc,
  className,
}: {
  src: string
  className?: string
}) {
  let src = ''
  for (const ch of safeMediaSrc(rawSrc)) {
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
  if (!src) return null
  return (
    <div
      className={cn(
        'border-border overflow-hidden rounded-xl border',
        className,
      )}
    >
      <Image
        src={src}
        alt="Attached image"
        width={200}
        height={160}
        className="bg-muted/20 max-h-40 max-w-[200px] object-contain"
        unoptimized
      />
    </div>
  )
}
