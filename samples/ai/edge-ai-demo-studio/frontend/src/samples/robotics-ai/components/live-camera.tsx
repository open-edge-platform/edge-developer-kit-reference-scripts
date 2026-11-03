// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { RefreshCcw, Video } from 'lucide-react'
import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useRoboticsCamera } from '../hooks/use-robotics-camera'

/**
 * The worker's live MJPEG camera stream with a Reload button. When the stream drops, the `<img>`
 * errors and the stream reopens once the camera reports ready again, instead of freezing.
 */
export function LiveCamera({
  workerBaseUrl,
  className,
}: {
  workerBaseUrl: string
  className?: string
}) {
  const imgRef = useRef<HTMLImageElement>(null)
  const camera = useRoboticsCamera(workerBaseUrl, imgRef)

  return (
    <div className={cn('space-y-2', className)}>
      <div className="bg-muted relative aspect-video w-full overflow-hidden rounded-lg">
        {/* eslint-disable-next-line @next/next/no-img-element -- live MJPEG camera stream; next/image would break the multipart stream */}
        <img
          ref={imgRef}
          className="absolute inset-0 h-full w-full object-contain"
          src={`${workerBaseUrl}/stream/camera`}
          alt="Live camera stream"
          onLoad={camera.handleStreamLoad}
          onError={camera.handleStreamError}
        />
        {!camera.isConnected && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="text-center text-white">
              <Video className="mx-auto mb-1 h-6 w-6" aria-hidden />
              <p className="text-sm">Camera Disconnected</p>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p role="status" className="text-muted-foreground text-xs">
          {camera.statusMessage}
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={camera.isReloading}
          onClick={camera.reload}
          className="gap-1.5"
        >
          <RefreshCcw
            className={cn('h-3.5 w-3.5', camera.isReloading && 'animate-spin')}
            aria-hidden
          />
          {camera.isReloading ? 'Reloading…' : 'Reload Camera'}
        </Button>
      </div>
    </div>
  )
}
