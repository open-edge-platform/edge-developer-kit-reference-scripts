// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader2, Monitor, Play, Video } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { useWebcamStream } from '../hooks/use-webcam-stream'

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
>

export function WebcamStream({
  error,
  isReady,
  startCamera,
  stopCamera,
  videoRef,
  devices,
  selectedDeviceId,
  listDevices,
}: WebcamStreamProps) {
  const [localSelectedDeviceId, setLocalSelectedDeviceId] = useState<
    string | null
  >(selectedDeviceId || devices[0]?.deviceId || null)
  const [isConnecting, setIsConnecting] = useState(false)

  const handleSelectOpen = async () => {
    await listDevices(true)
  }

  return (
    <div className="border-border flex h-full max-h-full flex-col rounded-xl border">
      <div className="flex-shrink-0 px-5 pt-5 pb-3">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <Video className="h-5 w-5 text-rose-500" />
              Webcam Stream
            </h3>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Connect your webcam to capture images for analysis during chat.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {error && <Badge variant="destructive">{error}</Badge>}
            {isReady ? (
              <>
                <div className="flex items-center gap-2 rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700 dark:bg-green-900/20 dark:text-green-400">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
                  Connected
                </div>
                <Button variant="destructive" size="sm" onClick={stopCamera}>
                  Disconnect
                </Button>
              </>
            ) : (
              <div className="flex gap-2">
                <Select
                  value={localSelectedDeviceId || 'no-selection'}
                  onValueChange={setLocalSelectedDeviceId}
                  onOpenChange={(open) => {
                    if (open) handleSelectOpen()
                  }}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Select camera">
                      {localSelectedDeviceId
                        ? (devices.find(
                            (d) => d.deviceId === localSelectedDeviceId,
                          )?.label ?? 'No camera')
                        : (devices[0]?.label ?? 'No camera')}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {devices.length === 0 && (
                      <SelectItem value="no-selection">No camera</SelectItem>
                    )}
                    {devices.map((device) => (
                      <SelectItem
                        key={device.deviceId || 'no-camera'}
                        value={device.deviceId || 'no-camera'}
                      >
                        {device.deviceId ? device.label : 'No camera'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  onClick={async () => {
                    setIsConnecting(true)
                    try {
                      await startCamera(localSelectedDeviceId || undefined)
                    } finally {
                      setIsConnecting(false)
                    }
                  }}
                  disabled={isConnecting}
                  className="bg-primary hover:bg-primary-light text-white"
                >
                  {isConnecting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" />
                  )}
                  {isConnecting ? 'Connecting…' : 'Connect'}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-4 pt-0">
        <div className="bg-muted/20 border-border relative h-full min-h-[300px] w-full overflow-hidden rounded-lg border-2 border-dashed">
          <video
            ref={videoRef}
            className={`absolute inset-0 h-full w-full object-contain ${
              isReady ? 'block' : 'hidden'
            }`}
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
