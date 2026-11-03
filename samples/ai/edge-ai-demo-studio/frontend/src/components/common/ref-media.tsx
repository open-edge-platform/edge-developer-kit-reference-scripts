// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useRef, type CSSProperties } from 'react'

/**
 * Image whose src (object or data URL) is set via ref rather than a dynamic prop, which keeps
 * static analysers happy and revocation Strict Mode-safe.
 */
export function RefImage({
  src,
  alt,
  className,
  style,
  loading,
  onLoad,
  onError,
}: {
  src: string
  alt: string
  className?: string
  style?: CSSProperties
  loading?: 'lazy' | 'eager'
  onLoad?: () => void
  onError?: () => void
}) {
  const imgRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    const img = imgRef.current
    if (!img) return
    img.src = src
    return () => {
      img.removeAttribute('src')
    }
  }, [src])

  return (
    // eslint-disable-next-line @next/next/no-img-element -- src is a local object URL / data URL assigned imperatively; next/image cannot optimize these
    <img
      ref={imgRef}
      alt={alt}
      className={className}
      style={style}
      loading={loading}
      onLoad={onLoad}
      onError={onError}
    />
  )
}

/** Video counterpart of `RefImage`; the caller owns the URL's create/revoke. */
export function RefVideo({
  src,
  className,
  controls = true,
  muted = true,
  playsInline = true,
  autoPlay,
}: {
  src: string
  className?: string
  controls?: boolean
  muted?: boolean
  playsInline?: boolean
  autoPlay?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.src = src
    return () => {
      video.removeAttribute('src')
    }
  }, [src])

  return (
    <video
      ref={videoRef}
      className={className}
      controls={controls}
      muted={muted}
      playsInline={playsInline}
      autoPlay={autoPlay}
    />
  )
}
