// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  Loader2,
  MonitorPlay,
  Play,
  Radio,
  Unplug,
  Video,
  Volume2,
} from 'lucide-react'
import type { RefObject } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'

export interface AvatarStreamProps {
  videoRef: RefObject<HTMLVideoElement | null>
  isConnected: boolean
  isConnecting: boolean
  statusMessage: string | null
  onConnect: () => void
  onDisconnect: () => void
  /** When true, shows a "Speaking" overlay badge on the video. */
  isSpeaking?: boolean
  /** When provided, shows a session ID badge below the video. */
  sessionId?: string | null
}

export function AvatarStream({
  videoRef,
  isConnected,
  isConnecting,
  statusMessage,
  onConnect,
  onDisconnect,
  isSpeaking,
  sessionId,
}: AvatarStreamProps) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
              isConnected
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground',
            )}
          >
            <MonitorPlay className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-sm">Avatar Stream</CardTitle>
            <p className="text-muted-foreground truncate text-xs">
              Real-time lip-synced AI avatar via WebRTC
            </p>
          </div>
        </div>
        <CardAction className="flex items-center gap-2">
          {sessionId && (
            <div className="px-4 py-2">
              <Badge variant="secondary" className="font-mono text-[10px]">
                Session: {sessionId}
              </Badge>
            </div>
          )}
          {!isConnected ? (
            <Button
              data-testid="avatar-connect-button"
              onClick={onConnect}
              disabled={isConnecting}
              size="sm"
              className="bg-primary hover:bg-primary-light text-white"
            >
              {isConnecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {isConnecting ? 'Connecting…' : 'Connect'}
            </Button>
          ) : (
            <Button
              data-testid="avatar-disconnect-button"
              onClick={onDisconnect}
              variant="destructive"
              size="sm"
            >
              <Unplug className="h-3.5 w-3.5" />
              Disconnect
            </Button>
          )}
        </CardAction>
      </CardHeader>

      <CardContent className="relative p-0">
        <div
          className={cn(
            'relative aspect-video w-full overflow-hidden',
            isConnected ? 'bg-black' : 'bg-muted/30',
          )}
        >
          <div
            className={cn('h-full w-full', isConnected ? 'block' : 'hidden')}
          >
            <video
              data-testid="avatar-video"
              ref={videoRef}
              autoPlay
              playsInline
              className="h-full w-full object-contain"
            />
          </div>

          {!isConnected && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
              <div className="bg-muted/60 flex h-16 w-16 items-center justify-center rounded-2xl">
                <Video className="text-muted-foreground/50 h-8 w-8" />
              </div>
              <div className="max-w-xs space-y-1.5">
                <p className="text-foreground text-sm font-medium">
                  Avatar stream offline
                </p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Click <strong>Connect</strong> to start a WebRTC session. The
                  avatar will lip-sync responses from the AI in real time.
                </p>
              </div>
            </div>
          )}

          {isConnected && (statusMessage || isSpeaking) && (
            <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2">
              {statusMessage && (
                <Badge
                  data-testid="avatar-status-message"
                  variant="secondary"
                  className="pointer-events-auto border-none bg-black/60 text-white backdrop-blur-sm"
                >
                  <Radio className="h-3 w-3 text-emerald-400" />
                  {statusMessage}
                </Badge>
              )}
              {isSpeaking && (
                <Badge
                  variant="secondary"
                  className="pointer-events-auto border-none bg-black/60 text-white backdrop-blur-sm"
                >
                  <Volume2 className="h-3 w-3 animate-pulse text-sky-400" />
                  Speaking
                </Badge>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
