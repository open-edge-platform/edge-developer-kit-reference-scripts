// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'

/** http(s):// or server-relative URLs that need to be downloaded. */
function isHttpUrl(src: string): boolean {
  return /^(https?:\/\/|\/)/i.test(src)
}

/** blob: object URLs and data: URIs, already resolvable locally. */
function isLocalUrl(src: string): boolean {
  return /^(blob:|data:)/i.test(src)
}

async function fetchBlob(url: string): Promise<Blob> {
  let imgURL: URL = new URL(url)
  if (!url.startsWith('blob:')) {
    imgURL = new URL(url, window.location.origin)
  }
  const res = await fetch(imgURL)
  if (!res.ok) {
    throw new Error(`Failed to load image from ${url}: ${res.status}`)
  }
  return res.blob()
}

export function useImagePreviewUrl(src: string | null | undefined) {
  const enabled = !!src && (isHttpUrl(src) || isLocalUrl(src))
  const {
    data: blob,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['image-preview-url', src],
    queryFn: () => fetchBlob(src as string),
    enabled,
    staleTime: Infinity,
    retry: 1,
  })

  const previewUrl = useMemo(
    () => (blob ? URL.createObjectURL(blob) : undefined),
    [blob],
  )
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  return { blob, previewUrl, isLoading, error }
}
