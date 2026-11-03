// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  Loader,
  MonitorPlay,
  Play,
  Radio,
  Unplug,
  Video,
  Volume2,
} from 'lucide-react'
import type { RefObject } from 'react'
import { TruncatedText } from '@/components/common/truncated-text'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
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
  /** Connected, but the WebRTC media path has no frames yet: shows an overlay. */
  isEstablishing?: boolean
  /** When provided, shows the session id beside the connection action. */
  sessionId?: string | null
  /** The placeholder text while no session is connected. */
  offlineHint?: string
}

/** The avatar session's state in a word, never by colour alone. */
function sessionLabel({
  isConnected,
  isConnecting,
  isEstablishing,
}: Pick<AvatarStreamProps, 'isConnected' | 'isConnecting' | 'isEstablishing'>) {
  if (isConnecting) return 'Connecting'
  if (!isConnected) return 'Not connected'
  return isEstablishing ? 'Starting video' : 'Connected'
}

/** The header stacks below `sm` so the action and session id keep their full width on a phone. */
export function AvatarStream({
  videoRef,
  isConnected,
  isConnecting,
  statusMessage,
  onConnect,
  onDisconnect,
  isSpeaking,
  isEstablishing,
  sessionId,
  offlineHint = 'Connect to start a WebRTC session in this browser tab. The avatar then lip-syncs the text or audio you send.',
}: AvatarStreamProps) {
  const label = sessionLabel({ isConnected, isConnecting, isEstablishing })

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
              isConnected
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground',
            )}
          >
            <MonitorPlay aria-hidden="true" className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-sm">Avatar stream</CardTitle>
            <p
              className="text-muted-foreground text-xs"
              data-testid="avatar-session-state"
            >
              Session: <span className="text-foreground">{label}</span>
            </p>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap sm:justify-end">
          {sessionId && (
            <Badge
              variant="secondary"
              className="max-w-full min-w-0 font-mono text-xs sm:max-w-48"
            >
              <span className="shrink-0">Session</span>
              <TruncatedText
                text={sessionId}
                data-testid="avatar-session-id"
                className="max-w-full"
              />
            </Badge>
          )}
          {!isConnected ? (
            <Button
              data-testid="avatar-connect-button"
              onClick={onConnect}
              disabled={isConnecting}
              size="sm"
              className="shrink-0"
            >
              {isConnecting ? (
                <Loader
                  aria-hidden="true"
                  className="h-3.5 w-3.5 animate-spin"
                />
              ) : (
                <Play aria-hidden="true" className="h-3.5 w-3.5" />
              )}
              {isConnecting ? 'Connecting…' : 'Connect'}
            </Button>
          ) : (
            <Button
              data-testid="avatar-disconnect-button"
              onClick={onDisconnect}
              variant="destructive"
              size="sm"
              className="shrink-0"
            >
              <Unplug aria-hidden="true" className="h-3.5 w-3.5" />
              Disconnect
            </Button>
          )}
        </div>
      </div>

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

          {isConnected && isEstablishing && (
            <div
              data-testid="avatar-establishing-overlay"
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center"
            >
              <Loader
                aria-hidden="true"
                className="h-7 w-7 animate-spin text-white/70"
              />
              <p className="text-xs text-white/80">
                Establishing media connection…
              </p>
            </div>
          )}

          {!isConnected && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="bg-muted/60 hidden h-14 w-14 items-center justify-center rounded-2xl sm:flex">
                <Video
                  aria-hidden="true"
                  className="text-muted-foreground/60 h-7 w-7"
                />
              </div>
              <div className="max-w-sm space-y-1.5">
                <p className="text-foreground text-sm font-medium">
                  {isConnecting ? 'Connecting…' : 'No avatar session'}
                </p>
                <p
                  className="text-muted-foreground text-xs leading-relaxed"
                  data-testid="avatar-connect-hint"
                >
                  {/* What a long connect waits for (a first MuseTalk
                      session prepares the avatar). */}
                  {isConnecting && statusMessage ? statusMessage : offlineHint}
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
                  <Radio aria-hidden="true" className="text-success h-3 w-3" />
                  {statusMessage}
                </Badge>
              )}
              {isSpeaking && (
                <Badge
                  variant="secondary"
                  className="pointer-events-auto border-none bg-black/60 text-white backdrop-blur-sm"
                >
                  <Volume2
                    aria-hidden="true"
                    className="text-info h-3 w-3 animate-pulse"
                  />
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
