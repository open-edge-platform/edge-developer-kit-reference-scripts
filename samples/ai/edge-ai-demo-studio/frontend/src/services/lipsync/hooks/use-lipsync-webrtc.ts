// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { RefObject } from 'react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getServiceMetadata } from '@/lib/instances/service-metadata'
import { getErrorMessage } from '@/lib/errors'
import {
  buildIceConfig,
  prepareAvatar,
  useLipsyncOffer,
  waitForIceGathering,
} from './index'

/** How long a `disconnected` connection may take to come back. */
const RECONNECT_GRACE_MS = 10_000

export interface UseLipsyncWebRtcOptions {
  /** `undefined` until the instance is added. */
  service: { apiBase?: string; metadata?: unknown } | undefined
  videoRef: RefObject<HTMLVideoElement | null>
}

export interface UseLipsyncWebRtcResult {
  sessionId: string | null
  statusMessage: string | null
  isConnecting: boolean
  isMediaConnected: boolean
  connect: () => Promise<void>
  disconnect: () => void
}

/**
 * WebRTC session for the lipsync avatar stream. The connection is current from the start, so
 * disconnecting, a new connect or unmounting mid-negotiation closes it.
 */
export function useLipsyncWebRtc({
  service,
  videoRef,
}: UseLipsyncWebRtcOptions): UseLipsyncWebRtcResult {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isMediaConnected, setIsMediaConnected] = useState(false)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  // Stops waiting for the avatar's preparation when the connection is given up.
  const prepareAbortRef = useRef<AbortController | null>(null)
  const disconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )

  const clientIceServerUrl = getServiceMetadata(
    service ?? {},
  ).clientIceServerUrl
  const { mutateAsync: sendOffer } = useLipsyncOffer(service?.apiBase)

  const clearGraceTimer = () => {
    if (disconnectTimeoutRef.current) {
      clearTimeout(disconnectTimeoutRef.current)
      disconnectTimeoutRef.current = null
    }
  }

  /** Closes the current connection, whether set up or still negotiating. */
  const disconnect = () => {
    clearGraceTimer()
    prepareAbortRef.current?.abort()
    prepareAbortRef.current = null
    pcRef.current?.close()
    pcRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setSessionId(null)
    setStatusMessage(null)
    setIsMediaConnected(false)
    setIsConnecting(false)
  }

  const connect = async () => {
    // Tear down a live or negotiating connection so it isn't orphaned.
    if (pcRef.current) disconnect()

    setStatusMessage(null)
    setIsConnecting(true)
    setIsMediaConnected(false)

    const pc = new RTCPeerConnection(buildIceConfig(clientIceServerUrl, 'stun'))
    pcRef.current = pc
    // Disconnected, replaced or unmounted meanwhile: `pc` was closed then.
    const isCurrent = () => pcRef.current === pc
    let iceGatheringTimedOut = false

    pc.addEventListener('track', (event) => {
      if (isCurrent() && videoRef.current && event.streams[0]) {
        videoRef.current.srcObject = event.streams[0]
      }
    })

    pc.addEventListener('connectionstatechange', () => {
      if (!isCurrent()) return
      if (pc.connectionState === 'connected') {
        clearGraceTimer()
        iceGatheringTimedOut = false
        setIsMediaConnected(true)
        setStatusMessage('Connected')
      } else if (pc.connectionState === 'failed') {
        disconnect()
        toast.error(
          iceGatheringTimedOut
            ? 'Could not establish media connection — check the configured ICE server'
            : 'WebRTC connection lost',
        )
      } else if (pc.connectionState === 'disconnected') {
        setStatusMessage('Reconnecting...')
        if (!disconnectTimeoutRef.current) {
          disconnectTimeoutRef.current = setTimeout(() => {
            disconnectTimeoutRef.current = null
            if (isCurrent() && pc.connectionState !== 'connected') {
              disconnect()
              toast.error('WebRTC connection lost')
            }
          }, RECONNECT_GRACE_MS)
        }
      }
    })

    try {
      // Before negotiating: the offer is answered only once the avatar is
      // loaded, and a first MuseTalk session would outwait the proxy.
      const prepareAbort = new AbortController()
      prepareAbortRef.current = prepareAbort
      await prepareAvatar(service?.apiBase, {
        signal: prepareAbort.signal,
        onStatus: ({ status, stage, done, total }) => {
          if (isCurrent() && status === 'preparing') {
            const step =
              stage === 'latents'
                ? 'Encoding the avatar'
                : 'Preparing the avatar'
            setStatusMessage(
              total ? `${step}: ${done ?? 0} of ${total} frames` : `${step}…`,
            )
          }
        },
      })
      if (!isCurrent()) return
      prepareAbortRef.current = null
      setStatusMessage(null)

      pc.addTransceiver('video', { direction: 'recvonly' })
      pc.addTransceiver('audio', { direction: 'recvonly' })

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      const gatheringCompleted = await waitForIceGathering(pc)
      if (!isCurrent()) return
      if (!gatheringCompleted) {
        iceGatheringTimedOut = true
        toast.warning(
          'ICE gathering timed out — the configured ICE server may be unreachable. Trying to connect anyway…',
        )
      }

      const answer = await sendOffer({
        sdp: pc.localDescription?.sdp ?? offer.sdp,
        type: pc.localDescription?.type ?? offer.type,
      })
      if (!isCurrent()) return

      await pc.setRemoteDescription(
        new RTCSessionDescription({ sdp: answer.sdp, type: answer.type }),
      )
      if (!isCurrent()) return
      setSessionId(answer.session_id)
      setIsConnecting(false)
    } catch (e) {
      // A connection given up meanwhile fails quietly: it was closed on purpose.
      if (!isCurrent()) return
      disconnect()
      toast.error(getErrorMessage(e, 'Failed to connect'))
    }
  }

  const closeConnection = useEffectEvent(() => disconnect())

  useEffect(() => {
    if (sessionId === null) return
    const onBeforeUnload = () => closeConnection()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [sessionId])

  // Close the connection on unmount — also one still negotiating. The
  // beforeunload listener above only covers a page unload.
  useEffect(() => () => closeConnection(), [])

  return {
    sessionId,
    statusMessage,
    isConnecting,
    isMediaConnected,
    connect,
    disconnect,
  }
}
