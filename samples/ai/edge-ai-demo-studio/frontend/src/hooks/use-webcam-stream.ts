// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefCallback,
} from 'react'

export interface VideoDevice {
  deviceId: string
  label: string
}

export function useWebcamStream() {
  const videoNodeRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const videoRef: RefCallback<HTMLVideoElement> = useCallback((node) => {
    videoNodeRef.current = node
    if (node && streamRef.current) {
      node.srcObject = streamRef.current
      node.play().catch(() => {})
    }
  }, [])

  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [devices, setDevices] = useState<VideoDevice[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)

  const clearError = useCallback(() => setError(null), [])

  const listDevices = useCallback(async (requestPermission = false) => {
    try {
      if (requestPermission) {
        const initialDevices = await navigator.mediaDevices.enumerateDevices()
        const hasVideoInputs = initialDevices.some(
          (device) => device.kind === 'videoinput',
        )
        if (hasVideoInputs) {
          const tempStream = await navigator.mediaDevices.getUserMedia({
            video: true,
          })
          for (const track of tempStream.getTracks()) track.stop()
        }
      }

      const allDevices = await navigator.mediaDevices.enumerateDevices()
      const videoDevices = allDevices
        .filter((device) => device.kind === 'videoinput')
        .map((device) => ({
          deviceId: device.deviceId,
          label: device.label || `Camera ${device.deviceId.slice(0, 5)}`,
        }))

      setDevices(videoDevices)
      return videoDevices
    } catch {
      setError('Unable to list devices')
      return []
    }
  }, [])

  const startCamera = useCallback(
    async (deviceId?: string) => {
      try {
        const constraints: MediaStreamConstraints = {
          video: deviceId
            ? { deviceId: { exact: deviceId } }
            : { facingMode: 'user' },
          audio: false,
        }

        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        streamRef.current = stream

        if (videoNodeRef.current) {
          videoNodeRef.current.srcObject = stream
          await videoNodeRef.current.play()
          setIsReady(true)
          clearError()

          const videoTrack = stream.getVideoTracks()[0]
          const activeDeviceId = videoTrack?.getSettings().deviceId
          if (activeDeviceId) {
            setSelectedDeviceId(activeDeviceId)
          }

          await listDevices(false)
        }
      } catch {
        setError('Unable to access webcam')
      }
    },
    [clearError, listDevices],
  )

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop()
    }
    streamRef.current = null
    setIsReady(false)
    clearError()
  }, [clearError])

  const captureImage = useCallback((): string | null => {
    if (!videoNodeRef.current) return null

    const canvas = document.createElement('canvas')
    canvas.width = videoNodeRef.current.videoWidth
    canvas.height = videoNodeRef.current.videoHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(videoNodeRef.current, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  }, [])

  const checkPermission = useCallback(async (): Promise<boolean> => {
    try {
      const result = await navigator.permissions.query({
        name: 'camera' as PermissionName,
      })
      return result.state === 'granted'
    } catch {
      return false
    }
  }, [])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return

    const initializeDevices = async () => {
      const hasPermission = await checkPermission()
      await listDevices(hasPermission)
    }

    initializeDevices()
  }, [checkPermission, listDevices])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return

    const handleDeviceChange = async () => {
      const hasPermission = await checkPermission()
      await listDevices(hasPermission)
    }

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)

    return () => {
      navigator.mediaDevices.removeEventListener(
        'devicechange',
        handleDeviceChange,
      )
    }
  }, [checkPermission, listDevices])

  useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [stopCamera])

  return {
    videoRef,
    startCamera,
    stopCamera,
    captureImage,
    listDevices,
    devices,
    selectedDeviceId,
    isReady,
    error,
  }
}
