// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { FileAudio, Send, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Service } from '@/services/types'
import { AudioLipsyncTab } from './components/audio-lipsync-tab'
import { AvatarStream } from './components/avatar-stream'
import { AvatarsTab } from './components/avatars-tab'
import { ChatTab } from './components/chat-tab'
import { buildIceConfig, useLipsyncOffer } from './hooks'

export function LipsyncDemo({ service }: { service: Service }) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)

  const { mutateAsync: offerMutateAsync, isPending: isOfferPending } =
    useLipsyncOffer()

  const clientIceServerUrl = (
    service.metadata as { clientIceServerUrl?: string } | undefined
  )?.clientIceServerUrl

  const disconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )

  const connect = useCallback(async () => {
    setStatusMessage(null)

    try {
      const pc = new RTCPeerConnection(
        buildIceConfig(clientIceServerUrl, 'stun'),
      )

      pc.addEventListener('track', (event) => {
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0]
        }
      })

      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'connected') {
          if (disconnectTimeoutRef.current) {
            clearTimeout(disconnectTimeoutRef.current)
            disconnectTimeoutRef.current = null
          }
          setStatusMessage('Connected')
        } else if (pc.connectionState === 'failed') {
          if (disconnectTimeoutRef.current) {
            clearTimeout(disconnectTimeoutRef.current)
            disconnectTimeoutRef.current = null
          }
          setSessionId(null)
          setStatusMessage(null)
          toast.error('WebRTC connection lost')
        } else if (pc.connectionState === 'disconnected') {
          setStatusMessage('Reconnecting...')
          if (!disconnectTimeoutRef.current) {
            disconnectTimeoutRef.current = setTimeout(() => {
              disconnectTimeoutRef.current = null
              if (pc.connectionState !== 'connected') {
                setSessionId(null)
                setStatusMessage(null)
                toast.error('WebRTC connection lost')
              }
            }, 10_000)
          }
        }
      })

      pc.addTransceiver('video', { direction: 'recvonly' })
      pc.addTransceiver('audio', { direction: 'recvonly' })

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') {
          resolve()
        } else {
          const onStateChange = () => {
            if (pc.iceGatheringState === 'complete') {
              pc.removeEventListener('icegatheringstatechange', onStateChange)
              resolve()
            }
          }
          pc.addEventListener('icegatheringstatechange', onStateChange)
        }
      })

      const answer = await offerMutateAsync({
        sdp: pc.localDescription?.sdp ?? offer.sdp,
        type: (pc.localDescription?.type ?? offer.type) as RTCSdpType,
      })

      await pc.setRemoteDescription(
        new RTCSessionDescription({ sdp: answer.sdp, type: answer.type }),
      )

      pcRef.current = pc
      setSessionId(answer.session_id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to connect')
    }
  }, [offerMutateAsync, clientIceServerUrl])

  const disconnect = useCallback(() => {
    if (disconnectTimeoutRef.current) {
      clearTimeout(disconnectTimeoutRef.current)
      disconnectTimeoutRef.current = null
    }
    if (pcRef.current) {
      pcRef.current.close()
      pcRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setSessionId(null)
    setStatusMessage(null)
  }, [])

  useEffect(() => {
    if (sessionId === null) return
    window.addEventListener('beforeunload', disconnect)
    return () => window.removeEventListener('beforeunload', disconnect)
  }, [sessionId, disconnect])

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(0,400px)]">
      <AvatarStream
        videoRef={videoRef}
        isConnected={sessionId !== null}
        isConnecting={isOfferPending}
        statusMessage={statusMessage}
        sessionId={sessionId}
        onConnect={connect}
        onDisconnect={disconnect}
      />

      <Tabs defaultValue="audio">
        <TabsList>
          <TabsTrigger value="audio">
            <FileAudio className="h-3.5 w-3.5" />
            Audio Lipsync
          </TabsTrigger>
          <TabsTrigger value="chat">
            <Send className="h-3.5 w-3.5" />
            Chat
          </TabsTrigger>
          <TabsTrigger value="avatars">
            <Upload className="h-3.5 w-3.5" />
            Avatars
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="space-y-3">
          <ChatTab sessionId={sessionId} />
        </TabsContent>

        <TabsContent value="audio" className="space-y-4">
          <AudioLipsyncTab sessionId={sessionId} />
        </TabsContent>

        <TabsContent value="avatars" className="space-y-4">
          <AvatarsTab sessionId={sessionId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
