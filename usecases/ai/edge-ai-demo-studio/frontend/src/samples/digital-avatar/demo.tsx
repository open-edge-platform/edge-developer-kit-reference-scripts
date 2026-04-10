// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useGetService } from '@/context/service-status-context'
import {
  useOptionalServiceGroup,
  useRagChatSetup,
  useTextGenerationParams,
  useTtsParams,
  useWakeWordStt,
} from '@/samples/common/hooks'
import { useTextGenChat } from '@/services/text-generation/hooks'
import { AvatarStream } from '@/services/lipsync/components/avatar-stream'
import {
  buildIceConfig,
  useLipsyncChat,
  useLipsyncOffer,
} from '@/services/lipsync/hooks'
import type { Sample } from '../types'
import { ChatPanel } from './components/chat-panel'
import { SampleParamsSlot } from '../common/sample-params-slot'
import { extractTextContent } from '@/services/text-generation/components/chat-helpers'

export function DigitalAvatarDemo({ sample }: { sample: Sample }) {
  // ── Parameter groups ─────────────────────────────────────────
  const textGen = useTextGenerationParams()
  const tts = useTtsParams(sample.id, { optional: false })

  const stt = useOptionalServiceGroup({
    serviceId: 'speech-to-text',
    serviceLabel: 'Speech to Text',
    offlineMessage:
      'Enable STT for voice input. Start the service from the services page.',
  })

  const { mcp, ragGroups, extraBody } = useRagChatSetup()

  // ── WebRTC connection state ──────────────────────────────────
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [isSpeaking, setIsSpeaking] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const disconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )

  const offerMutation = useLipsyncOffer()
  const lipsyncService = useGetService('lipsync')
  const ttsService = useGetService('text-to-speech')
  const textGenService = useGetService('text-generation')
  const isMultimodal = textGenService?.currentModelType === 'multimodal'
  const clientIceServerUrl = (
    lipsyncService?.metadata as { clientIceServerUrl?: string } | undefined
  )?.clientIceServerUrl

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

      const answer = await offerMutation.mutateAsync({
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
  }, [offerMutation, clientIceServerUrl])

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

  // ── Chat (text-generation) ───────────────────────────────────
  const chat = useTextGenChat({ textGenValues: textGen.values, extraBody })

  // ── Wake word → auto-trigger STT recording ──────────────────
  const { wakeWord } = useWakeWordStt({
    onTranscription: useCallback(
      (text: string) => {
        chat.setInput(text)
      },
      // chat.setInput is stable
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    ),
  })

  const lipsyncChatMutation = useLipsyncChat()
  const prevMessageCountRef = useRef(0)

  useEffect(() => {
    if (chat.status !== 'ready') return
    if (!sessionId) return
    if (chat.messages.length <= prevMessageCountRef.current) {
      prevMessageCountRef.current = chat.messages.length
      return
    }
    prevMessageCountRef.current = chat.messages.length

    const lastMsg = chat.messages[chat.messages.length - 1]
    if (!lastMsg || lastMsg.role !== 'assistant') return

    const text = extractTextContent(lastMsg)

    if (!text.trim()) return

    const ttsUrl = ttsService
      ? `http://localhost:${ttsService.port}/v1`
      : undefined

    setIsSpeaking(true)
    lipsyncChatMutation.mutate(
      {
        session_id: sessionId,
        chat_type: 'echo',
        text: text.trim(),
        voice: tts.values.voice,
        speed: String(tts.values.speed),
        tts_url: ttsUrl,
      },
      {
        onSettled: () => setIsSpeaking(false),
      },
    )
    // Only trigger when status transitions to 'ready' (response complete)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.status, sessionId])

  return (
    <div className="space-y-5">
      {/* Main layout — avatar hero + sidebar chat */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_minmax(0,400px)]">
        <AvatarStream
          videoRef={videoRef}
          isConnected={sessionId !== null}
          isConnecting={offerMutation.isPending}
          statusMessage={statusMessage}
          isSpeaking={isSpeaking}
          onConnect={connect}
          onDisconnect={disconnect}
        />
        <SampleParamsSlot
          groups={[
            textGen.group,
            tts.group,
            stt.group,
            wakeWord.group,
            ...ragGroups,
            mcp.group,
          ]}
        />
        <ChatPanel
          messages={chat.messages}
          status={chat.status}
          input={chat.input}
          onInputChange={chat.setInput}
          onSend={chat.handleSend}
          onReset={chat.handleReset}
          isConnected={sessionId !== null}
          sttOnline={stt.enabled}
          isVlm={isMultimodal}
          imagePreview={chat.imagePreview}
          onImageSelect={chat.handleImageSelect}
          onImageRemove={chat.handleRemoveImage}
        />
      </div>
    </div>
  )
}
