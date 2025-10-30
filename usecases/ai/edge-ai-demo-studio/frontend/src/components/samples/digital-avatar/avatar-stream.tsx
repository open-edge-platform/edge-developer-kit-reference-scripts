// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useGetRTCOffer } from '@/hooks/use-lipsync'
import { Loader2, Monitor, Play, Video } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

interface AvatarStreamProps {
  onSessionIdChange: (sessionId: string) => void
  connectionStatus: string
  setConnectionStatus: (status: string) => void
  disabled: boolean
  turnServerIp?: string
}

export function AvatarStream({
  disabled,
  onSessionIdChange,
  connectionStatus,
  setConnectionStatus,
  turnServerIp,
}: AvatarStreamProps) {
  const [peerConnection, setPc] = useState<RTCPeerConnection>()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isIceConnecting, setIsIceConnecting] = useState(false)

  // Use refs to avoid useEffect dependency issues
  const onSessionIdChangeRef = useRef(onSessionIdChange)
  const setConnectionStatusRef = useRef(setConnectionStatus)

  // Update refs when props change
  useEffect(() => {
    onSessionIdChangeRef.current = onSessionIdChange
    setConnectionStatusRef.current = setConnectionStatus
  }, [onSessionIdChange, setConnectionStatus])

  const { mutateAsync: getRTCOffer, isError: getRTCError } = useGetRTCOffer()

  const connectAvatar = () => {
    if (connectionStatus === 'connected') {
      peerConnection?.close()
    } else {
      setIsIceConnecting(true)
      const config: {
        sdpSemantics: string
        iceServers: RTCIceServer[]
      } = {
        sdpSemantics: 'unified-plan',
        iceServers: [],
      }

      if (turnServerIp) {
        config.iceServers.push({
          urls: [`turn:${turnServerIp}`],
          username: 'dummy',
          credential: 'dummy',
        })
      }

      setPc(new RTCPeerConnection(config))
    }
  }

  const disconnectAvatar = useCallback(() => {
    peerConnection?.close()
    setConnectionStatusRef.current('disconnected')
  }, [peerConnection])

  useEffect(() => {
    if (!peerConnection) return

    peerConnection.addEventListener('track', (evt) => {
      if (evt.track.kind === 'video') {
        if (videoRef.current) videoRef.current.srcObject = evt.streams[0]
      }
    })

    peerConnection.addEventListener('connectionstatechange', () => {
      const state = peerConnection.connectionState
      console.log('WebRTC connection state:', state)

      if (state === 'connected') {
        setConnectionStatusRef.current('connected')
        setIsIceConnecting(false)
        toast.success('Avatar connected successfully!')
      } else if (state === 'connecting') {
        setConnectionStatusRef.current('connecting')
        setIsIceConnecting(true)
      } else if (
        state === 'disconnected' ||
        state === 'failed' ||
        state === 'closed'
      ) {
        setConnectionStatusRef.current('disconnected')
        setIsIceConnecting(false)

        if (state === 'failed') {
          toast.error('Avatar connection failed')
        } else if (state === 'disconnected') {
          toast.info('Avatar disconnected')
        }
      }
    })

    peerConnection.addEventListener('iceconnectionstatechange', () => {
      const iceState = peerConnection.iceConnectionState
      console.log('ICE connection state:', iceState)

      if (iceState === 'connected' || iceState === 'completed') {
        setIsIceConnecting(false)
      } else if (iceState === 'checking') {
        setIsIceConnecting(true)
      } else if (
        iceState === 'disconnected' ||
        iceState === 'failed' ||
        iceState === 'closed'
      ) {
        setConnectionStatusRef.current('disconnected')
        setIsIceConnecting(false)

        if (iceState === 'failed') {
          toast.error(
            'Network connection failed. Please check your internet connection.',
          )
        }
      }
    })

    peerConnection.addTransceiver('video', { direction: 'recvonly' })
    peerConnection.addTransceiver('audio', { direction: 'recvonly' })

    peerConnection
      .createOffer()
      .then((offer) => {
        return peerConnection.setLocalDescription(offer)
      })
      .then(() => {
        return new Promise((resolve) => {
          if (peerConnection.iceGatheringState === 'complete') {
            resolve(0)
          } else {
            const checkState = () => {
              if (peerConnection.iceGatheringState === 'complete') {
                peerConnection.removeEventListener(
                  'icegatheringstatechange',
                  checkState,
                )
                resolve(0)
              }
            }
            peerConnection.addEventListener(
              'icegatheringstatechange',
              checkState,
            )
          }
        })
      })
      .then(() => {
        setConnectionStatusRef.current('connecting')
        setIsIceConnecting(true)

        const offer = peerConnection.localDescription
        if (!offer) return
        return getRTCOffer({ offer, turn: !!turnServerIp })
      })
      .then((answer) => {
        if (answer) {
          onSessionIdChangeRef.current(answer.session_id)
          return peerConnection.setRemoteDescription(answer)
        }
      })
      .catch((error) => {
        console.error('WebRTC connection error:', error)
        setConnectionStatusRef.current('disconnected')
        setIsIceConnecting(false)
        toast.error('Failed to establish avatar connection. Please try again.')
      })

    return () => {
      disconnectAvatar()
    }
  }, [getRTCOffer, peerConnection, disconnectAvatar, turnServerIp])

  useEffect(() => {
    if (getRTCError) {
      toast.error('Error connecting to avatar')
      setConnectionStatusRef.current('disconnected')
      setIsIceConnecting(false)
    }
  }, [getRTCError])

  const handleOnConnect = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    connectAvatar()
  }

  const handleOnDisconnect = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    disconnectAvatar()
  }

  return (
    <Card className="flex h-full max-h-full flex-col">
      <CardHeader className="flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Video className="h-5 w-5 text-blue-500" />
              Avatar Stream
            </CardTitle>
            <CardDescription>
              Real-time WebRTC video stream with synchronized audio
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {connectionStatus === 'connected' && !isIceConnecting && (
              <>
                <div className="flex items-center gap-2 rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700 dark:bg-green-900/20 dark:text-green-400">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-green-500"></div>
                  Connected
                </div>
                <Button variant="destructive" onClick={handleOnDisconnect}>
                  Disconnect
                </Button>
              </>
            )}
            {connectionStatus === 'disconnected' && !isIceConnecting && (
              <Button
                onClick={handleOnConnect}
                className="bg-blue-600 hover:bg-blue-700"
                disabled={disabled}
              >
                <Play className="mr-2 h-4 w-4" />
                Connect Avatar
              </Button>
            )}
            {(connectionStatus === 'connecting' || isIceConnecting) && (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 rounded-full bg-yellow-100 px-3 py-1 text-sm font-medium text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {connectionStatus === 'connecting'
                    ? 'Connecting...'
                    : 'Establishing connection...'}
                </div>
                {connectionStatus === 'connecting' && (
                  <Button variant="outline" onClick={handleOnDisconnect}>
                    Cancel
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-4">
        <div className="relative h-full min-h-0 w-full overflow-hidden rounded-lg border-2 border-dashed border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 dark:border-slate-700 dark:from-slate-900 dark:to-slate-800">
          <video
            ref={videoRef}
            className={`absolute inset-0 h-full w-full object-contain ${
              connectionStatus === 'connected' ? 'block' : 'hidden'
            }`}
            autoPlay
            playsInline
          ></video>
          {connectionStatus !== 'connected' && (
            <div className="absolute inset-0 flex h-full w-full items-center justify-center">
              <div className="text-center">
                <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-800">
                  <Monitor className="h-8 w-8 text-slate-400" />
                </div>
                <h3 className="mb-2 text-base font-semibold text-slate-700 dark:text-slate-300">
                  Avatar Disconnected
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Click &ldquo;Connect Avatar&rdquo; to start the video stream
                </p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
