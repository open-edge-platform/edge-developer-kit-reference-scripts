// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useState } from 'react'
import { useWebcamStream } from '@/hooks/use-webcam-stream'

export type ImageSourceInputMode = 'upload' | 'webcam'

/** A captured or uploaded image, plus its natural pixel size for overlays. */
export interface ImageSource {
  /** A `blob:` URL for an uploaded file, a `data:` URL for a webcam frame. */
  url: string
  file: File
  naturalWidth: number
  naturalHeight: number
}

/**
 * State behind an `ImageSourcePanel`. Owns the image's object URL (revoked on replace and unmount),
 * so callers never revoke one themselves.
 */
export function useImageSource({
  onSourceChange,
}: { onSourceChange?: (source: ImageSource | null) => void } = {}) {
  const webcam = useWebcamStream()
  const [inputMode, setInputMode] = useState<ImageSourceInputMode>('upload')
  const [source, setSourceState] = useState<ImageSource | null>(null)

  // Webcam frames are data: URLs: nothing to free.
  useEffect(() => {
    const url = source?.url
    return () => {
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
    }
  }, [source])

  const setSource = (next: ImageSource | null) => {
    setSourceState(next)
    onSourceChange?.(next)
  }

  return { inputMode, setInputMode, source, setSource, webcam }
}
