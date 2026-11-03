// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Bot, Loader } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { RefImage } from '@/components/common/ref-media'
import { cn } from '@/lib/utils'

interface AvatarSectionProps {
  streamUrl: string
  isSpeaking: boolean
}

export function AvatarSection({ streamUrl, isSpeaking }: AvatarSectionProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  // Cache-busts `src`, so each reconnect after a stream error opens a fresh stream.
  const [reconnectToken, setReconnectToken] = useState(() => Date.now())
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )

  useEffect(() => {
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

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }
    reconnectTimeoutRef.current = setTimeout(() => {
      setIsLoading(true)
      setReconnectToken(Date.now())
    }, 2000)
  }

  const separator = streamUrl.includes('?') ? '&' : '?'
  const src = `${streamUrl}${separator}t=${reconnectToken}`

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-primary/10 flex h-8 w-8 items-center justify-center rounded-lg">
            <Bot className="text-primary h-4 w-4" aria-hidden />
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
            <Badge tone="info">
              <span
                className="bg-info mr-0.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full"
                aria-hidden
              />
              Speaking
            </Badge>
          )}
          {!isLoading && !hasError && (
            <Badge tone="success">
              <span
                className="bg-success mr-0.5 inline-block h-1.5 w-1.5 rounded-full"
                aria-hidden
              />
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
            <Loader
              className="text-muted-foreground h-8 w-8 animate-spin"
              aria-label="Connecting to the avatar stream"
            />
          </div>
        )}
        {hasError && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <Bot
                className="text-muted-foreground/40 mx-auto mb-2 h-10 w-10"
                aria-hidden
              />
              <p className="text-muted-foreground text-sm">
                Reconnecting to avatar stream...
              </p>
            </div>
          </div>
        )}
        <RefImage
          src={src}
          alt="Avatar Stream"
          className="h-full w-full object-contain"
          onLoad={handleLoad}
          onError={handleError}
        />
      </div>
    </div>
  )
}
