// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Card, CardContent } from '@/components/ui/card'
import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'

export const AvatarSection = ({ streamUrl }: { streamUrl: string }) => {
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)

  useEffect(() => {
    // Add timestamp to URL to force reload on reconnect
    const loadStream = () => {
      if (imgRef.current) {
        const separator = streamUrl.includes('?') ? '&' : '?'
        imgRef.current.src = `${streamUrl}${separator}t=${Date.now()}`
      }
    }

    // Initial load
    loadStream()

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

    // Attempt to reconnect after 2 seconds
    reconnectTimeoutRef.current = setTimeout(() => {
      if (imgRef.current) {
        setIsLoading(true)
        const separator = streamUrl.includes('?') ? '&' : '?'
        imgRef.current.src = `${streamUrl}${separator}t=${Date.now()}`
      }
    }, 2000)
  }

  return (
    <Card className="flex h-full max-h-full flex-col">
      <CardContent className="flex-1 overflow-hidden p-4">
        <div className="relative flex h-full flex-col overflow-hidden rounded-lg border-0 bg-white/0 dark:bg-slate-800/0">
          {/* Avatar stream takes up full card */}
          <div className="relative h-125">
            {isLoading && (
              <div className="bg-muted/20 absolute inset-0 flex items-center justify-center">
                <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
              </div>
            )}
            {hasError && !isLoading && (
              <div className="bg-muted/20 absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <p className="text-muted-foreground text-sm">
                    Reconnecting to avatar stream...
                  </p>
                </div>
              </div>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              alt="Avatar Stream"
              className="h-full w-full object-contain"
              onLoad={handleLoad}
              onError={handleError}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
