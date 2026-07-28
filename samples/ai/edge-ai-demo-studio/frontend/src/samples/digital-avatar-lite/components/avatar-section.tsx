// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Bot, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface AvatarSectionProps {
  streamUrl: string
  isSpeaking: boolean
}

export function AvatarSection({ streamUrl, isSpeaking }: AvatarSectionProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )

  useEffect(() => {
    if (imgRef.current) {
      const separator = streamUrl.includes('?') ? '&' : '?'
      imgRef.current.src = `${streamUrl}${separator}t=${Date.now()}`
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
    }
  }, [streamUrl])

  const handleLoad = () => {
    setIsLoading(false)
    setHasError(false)
  }

  const handleError = () => {
    setIsLoading(false)
    setHasError(true)

    reconnectTimeoutRef.current = setTimeout(() => {
      if (imgRef.current) {
        setIsLoading(true)
        const separator = streamUrl.includes('?') ? '&' : '?'
        imgRef.current.src = `${streamUrl}${separator}t=${Date.now()}`
      }
    }, 2000)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
            <Bot className="h-4 w-4 text-violet-500" />
          </div>
          <div>
            <p className="text-sm font-medium">Avatar Stream</p>
            <p className="text-muted-foreground text-xs">
              MJPEG animated avatar
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isSpeaking && (
            <Badge
              variant="outline"
              className="border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400"
            >
              <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
              Speaking
            </Badge>
          )}
          {!isLoading && !hasError && (
            <Badge
              variant="outline"
              className="border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400"
            >
              <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
              Connected
            </Badge>
          )}
        </div>
      </div>

      <div
        className={cn(
          'relative aspect-video overflow-hidden rounded-lg border',
          !hasError && !isLoading
            ? 'border-border bg-black'
            : 'border-border bg-muted/20 border-dashed',
        )}
      >
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
          </div>
        )}
        {hasError && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <Bot className="text-muted-foreground/40 mx-auto mb-2 h-10 w-10" />
              <p className="text-muted-foreground text-sm">
                Reconnecting to avatar stream...
              </p>
            </div>
          </div>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element -- avatar stream src is assigned imperatively via ref; next/image requires a static src prop */}
        <img
          ref={imgRef}
          alt="Avatar Stream"
          className="h-full w-full object-contain"
          onLoad={handleLoad}
          onError={handleError}
        />
      </div>
    </div>
  )
}
