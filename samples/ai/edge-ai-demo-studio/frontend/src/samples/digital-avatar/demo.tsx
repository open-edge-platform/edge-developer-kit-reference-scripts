// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useGetService } from '@/context/service-status-context'
import { useFeatureCollector } from '@/context/feature-collector'
import {
  FeatureContexts,
  sttOnlineFromExports,
} from '@/samples/common/feature-providers/feature-contexts'
import { useFeatureProviders } from '@/samples/common/feature-providers/use-feature-providers'
import { useTextGenerationParams } from '@/samples/common/hooks/use-text-generation-params'
import { useTtsParams } from '@/services/text-to-speech/hooks/use-tts-params'
import { useTextGenChat } from '@/services/text-generation/hooks/use-chat'
import { AvatarStream } from '@/services/lipsync/components/avatar-stream'
import {
  buildIceConfig,
  useLipsyncOffer,
  waitForIceGathering,
} from '@/services/lipsync/hooks'
import type { Sample } from '../types'
import { ChatPanel } from './components/chat-panel'
import { SampleParamsSlot } from '../common/sample-params-slot'

// Optional-service feature integrations this sample wires (explicit opt-in).
// TTS + lipsync are required (handled directly). See docs/OPTIONAL-SERVICES.md.
const FEATURE_SERVICES = [
  'speech-to-text',
  'wake-word-detection',
  'vectordb',
  'mcp',
]

export function DigitalAvatarDemo({ sample }: { sample: Sample }) {
  const textGen = useTextGenerationParams()
  const tts = useTtsParams(sample.id, { optional: false })

  const featureProviders = useFeatureProviders(FEATURE_SERVICES)
  const collector = useFeatureCollector(FEATURE_SERVICES)
  const sttOnline = sttOnlineFromExports(collector.exports)

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isMediaConnected, setIsMediaConnected] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const iceGatheringTimedOutRef = useRef(false)
  const disconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )

  const { mutateAsync: offerMutateAsync } = useLipsyncOffer()
  const lipsyncService = useGetService('lipsync')
  const ttsService = useGetService('text-to-speech')
  const textGenService = useGetService('text-generation')
  const isMultimodal = textGenService?.currentModelType === 'multimodal'
  const clientIceServerUrl = (
    lipsyncService?.metadata as { clientIceServerUrl?: string } | undefined
  )?.clientIceServerUrl

  const connect = useCallback(async () => {
    setStatusMessage(null)
    setIsConnecting(true)
    setIsMediaConnected(false)
    iceGatheringTimedOutRef.current = false

    let createdPc: RTCPeerConnection | null = null
    try {
      const pc = new RTCPeerConnection(
        buildIceConfig(clientIceServerUrl, 'stun'),
      )
      createdPc = pc

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
          iceGatheringTimedOutRef.current = false
          setIsMediaConnected(true)
          setStatusMessage('Connected')
        } else if (pc.connectionState === 'failed') {
          if (disconnectTimeoutRef.current) {
            clearTimeout(disconnectTimeoutRef.current)
            disconnectTimeoutRef.current = null
          }
          setSessionId(null)
          setStatusMessage(null)
          toast.error(
            iceGatheringTimedOutRef.current
              ? 'Could not establish media connection — check the configured ICE server'
              : 'WebRTC connection lost',
          )
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

      const gatheringCompleted = await waitForIceGathering(pc)
      if (!gatheringCompleted) {
        iceGatheringTimedOutRef.current = true
        toast.warning(
          'ICE gathering timed out — the configured ICE server may be unreachable. Trying to connect anyway…',
        )
      }

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
      createdPc?.close()
      toast.error(e instanceof Error ? e.message : 'Failed to connect')
    } finally {
      setIsConnecting(false)
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
    setIsMediaConnected(false)
  }, [])

  useEffect(() => {
    if (sessionId === null) return
    window.addEventListener('beforeunload', disconnect)
    return () => window.removeEventListener('beforeunload', disconnect)
  }, [sessionId, disconnect])

  // ── Chat (text-generation) with server-side sentence splitting ─
  const ttsUrl = ttsService
    ? `http://localhost:${ttsService.port}/v1`
    : undefined

  const lipsyncExtraBody = sessionId
    ? {
        lipsync: {
          sessionId,
          voice: tts.values.voice,
          speed: String(tts.values.speed),
          ttsUrl,
        },
      }
    : {}

  const chat = useTextGenChat({
    textGenValues: textGen.values,
    requestParams: textGen.requestParams,
    extraBody: { ...collector.extraBody, ...lipsyncExtraBody },
  })

  const isSpeaking = chat.status === 'streaming' && !!sessionId

  return (
    <div className="space-y-5">
      <collector.Provider>
        {featureProviders.map(({ serviceId, Provider }) => (
          <Provider
            key={serviceId}
            onTranscription={chat.setInput}
            sampleId={sample.id}
          />
        ))}
      </collector.Provider>

      <FeatureContexts exports={collector.exports}>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_minmax(0,400px)]">
          <AvatarStream
            videoRef={videoRef}
            isConnected={sessionId !== null}
            isConnecting={isConnecting}
            isEstablishing={!isMediaConnected}
            statusMessage={statusMessage}
            isSpeaking={isSpeaking}
            onConnect={connect}
            onDisconnect={disconnect}
          />
          <SampleParamsSlot
            groups={[textGen.group, tts.group, ...collector.groups]}
          />
          <ChatPanel
            messages={chat.messages}
            status={chat.status}
            input={chat.input}
            onInputChange={chat.setInput}
            onSend={chat.handleSend}
            onReset={chat.handleReset}
            isConnected={sessionId !== null}
            sttOnline={sttOnline}
            isVlm={isMultimodal}
            imagePreviews={chat.imagePreviews}
            onImageSelect={chat.handleImageSelect}
            onImageRemove={chat.handleRemoveImage}
          />
        </div>
      </FeatureContexts>
    </div>
  )
}
