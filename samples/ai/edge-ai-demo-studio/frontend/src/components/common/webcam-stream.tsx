// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertCircle, Loader, Monitor, Play, Video } from 'lucide-react'
import { useState } from 'react'
import { TONES } from '@/components/common/tones'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { useWebcamStream } from '@/hooks/use-webcam-stream'
import { cn } from '@/lib/utils'

type WebcamStreamProps = Pick<
  ReturnType<typeof useWebcamStream>,
  | 'error'
  | 'isReady'
  | 'startCamera'
  | 'stopCamera'
  | 'videoRef'
  | 'devices'
  | 'selectedDeviceId'
  | 'listDevices'
> & {
  /** Heading shown above the video (defaults to "Webcam Stream"). */
  title?: string
  /** Sub-heading describing what the stream is used for. */
  description?: string
  /** Overrides the preview box's height classes (default: a 300px floor). */
  previewClassName?: string
}

/** Select value standing for "no camera listed", never a real device id. */
const NO_CAMERA = 'no-camera'

export function WebcamStream({
  error,
  isReady,
  startCamera,
  stopCamera,
  videoRef,
  devices,
  selectedDeviceId,
  listDevices,
  title = 'Webcam Stream',
  description = 'Connect your webcam to capture images for analysis during chat.',
  previewClassName,
}: WebcamStreamProps) {
  // The camera the user picked here; until then the one the hook last used,
  // else the first listed — derived, so it follows devices that load later.
  const [pickedDeviceId, setPickedDeviceId] = useState<string | null>(null)
  const listed = (id: string | null | undefined) =>
    id ? devices.find((d) => d.deviceId === id) : undefined
  const device =
    listed(pickedDeviceId) ?? listed(selectedDeviceId) ?? devices[0]
  const deviceId = device?.deviceId || undefined
  const [isConnecting, setIsConnecting] = useState(false)

  const connect = async () => {
    setIsConnecting(true)
    try {
      await startCamera(deviceId)
    } finally {
      setIsConnecting(false)
    }
  }

  return (
    // A container, so the header lays out by the card's own width — it may
    // share a row with another panel on a wide screen.
    <div className="border-border @container flex h-full max-h-full flex-col rounded-xl border">
      <div className="flex-shrink-0 px-4 pt-4 pb-3 @lg:px-5 @lg:pt-5">
        {/* Narrow, the heading stacks above the controls, which take the whole width. */}
        <div className="flex flex-col gap-3 @lg:flex-row @lg:items-center @lg:justify-between @lg:gap-4">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <Video
                aria-hidden="true"
                className="text-primary h-5 w-5 shrink-0"
              />
              {title}
            </h3>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {description}
            </p>
          </div>
          <div
            className="flex min-w-0 items-center gap-2 @lg:shrink-0 @lg:justify-end"
            data-testid="webcam-controls"
          >
            {isReady ? (
              <>
                <div
                  role="status"
                  className={cn(
                    'flex min-w-0 items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium',
                    TONES.success.pill,
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="bg-success h-2 w-2 shrink-0 animate-pulse rounded-full"
                  />
                  Connected
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  className="ml-auto @lg:ml-0"
                  onClick={stopCamera}
                >
                  Disconnect
                </Button>
              </>
            ) : (
              <>
                <Select
                  value={deviceId ?? NO_CAMERA}
                  onValueChange={(value) =>
                    setPickedDeviceId(value === NO_CAMERA ? null : value)
                  }
                  onOpenChange={(open) => {
                    if (open) listDevices(true)
                  }}
                >
                  <SelectTrigger
                    className="min-w-0 flex-1 @lg:w-[180px] @lg:flex-none"
                    aria-label="Camera"
                  >
                    <SelectValue placeholder="Select camera">
                      {device?.deviceId ? device.label : 'No camera'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {!deviceId && (
                      <SelectItem value={NO_CAMERA}>No camera</SelectItem>
                    )}
                    {devices
                      .filter((d) => d.deviceId)
                      .map((d) => (
                        <SelectItem key={d.deviceId} value={d.deviceId}>
                          {d.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={connect} disabled={isConnecting}>
                  {isConnecting ? (
                    <Loader
                      aria-hidden="true"
                      className="h-4 w-4 animate-spin"
                    />
                  ) : (
                    <Play aria-hidden="true" className="h-4 w-4" />
                  )}
                  {isConnecting ? 'Connecting…' : 'Connect'}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {error && !isReady && (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/5 mx-4 mb-3 flex items-start gap-2 rounded-lg border px-3 py-2"
        >
          <AlertCircle
            aria-hidden="true"
            className="text-destructive mt-0.5 h-4 w-4 shrink-0"
          />
          <p className="text-destructive min-w-0 flex-1 text-xs">{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 text-xs"
            disabled={isConnecting}
            onClick={connect}
          >
            Try again
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-hidden p-4 pt-0">
        <div
          className={cn(
            'bg-muted/20 border-border relative h-full min-h-[300px] w-full overflow-hidden rounded-lg border-2 border-dashed',
            previewClassName,
          )}
        >
          <video
            ref={videoRef}
            className={cn(
              'absolute inset-0 h-full w-full object-contain',
              isReady ? 'block' : 'hidden',
            )}
            autoPlay
            playsInline
          />
          {!isReady && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="bg-muted mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full">
                  <Monitor className="text-muted-foreground h-8 w-8" />
                </div>
                <h4 className="text-foreground mb-1 text-sm font-semibold">
                  Webcam Disconnected
                </h4>
                <p className="text-muted-foreground text-xs">
                  Click &ldquo;Connect&rdquo; to start the webcam stream
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
