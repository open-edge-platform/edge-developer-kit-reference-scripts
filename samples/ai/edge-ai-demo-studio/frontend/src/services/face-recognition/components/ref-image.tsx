// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useRef, type CSSProperties } from 'react'

/**
 * Image whose src (an object URL or worker-provided data URL) is assigned
 * imperatively via ref instead of a dynamic src prop, matching the pattern
 * used by FileDropZone's preview (keeps static analysers happy and revocation
 * Strict Mode-safe).
 */
export function RefImage({
  src,
  alt,
  className,
  style,
}: {
  src: string
  alt: string
  className?: string
  style?: CSSProperties
}) {
  const imgRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    const img = imgRef.current
    if (img) img.src = src
  }, [src])

  // eslint-disable-next-line @next/next/no-img-element -- src is a local object URL / data URL assigned imperatively; next/image cannot optimize these
  return <img ref={imgRef} alt={alt} className={className} style={style} />
}
