// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useEffectEvent, useState } from 'react'
import { resizeImage } from '@/samples/ai-exam-marking/lib/image-utils'

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** How long a dropped socket waits before it connects again. */
const RECONNECT_DELAY_MS = 1000

/** `waiting`: the watcher has no port yet (not running). */
export type ScannerConnection =
  'disconnected' | 'waiting' | 'connecting' | 'connected'

interface UseFileWatcherSocketOptions {
  /** Port the watching service listens on; the socket stays closed while undefined. */
  port: number | undefined
  /** Folder to watch; sent as a query param only when non-empty. */
  path: string
  active: boolean
  /** Each scanned image as a data URL resized to 612x792, with its file name. */
  onImage: (dataUrl: string, filename: string) => void
  /** The socket closed on its own, not by this hook; `failed` when it errored first. It reconnects while `active`. */
  onClosed: (failed: boolean) => void
}

function socketUrl(port: number, path: string): string {
  const url = new URL(`ws://127.0.0.1:${port}/ws`)
  if (path.trim()) url.searchParams.set('path', path.trim())
  return url.toString()
}

/** A folder watcher's WebSocket: open while `active`, resizing each scanned image for `onImage`. */
export function useFileWatcherSocket({
  port,
  path,
  active,
  onImage,
  onClosed,
}: UseFileWatcherSocketOptions): ScannerConnection {
  // The address of the socket that is open, if any.
  const [openUrl, setOpenUrl] = useState<string | null>(null)
  // Bumped to open a new socket after one dropped.
  const [attempt, setAttempt] = useState(0)
  const url = active && port ? socketUrl(port, path) : null

  const handleImage = useEffectEvent((dataUrl: string, filename: string) =>
    onImage(dataUrl, filename),
  )
  const handleClosed = useEffectEvent((failed: boolean) => onClosed(failed))

  useEffect(() => {
    if (!url) return
    const ws = new WebSocket(url)
    let failed = false
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    ws.onopen = () => setOpenUrl(url)

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data as string) as {
          filename: string
          base64: string
        }
        const ext = data.filename.split('.').pop()?.toLowerCase() ?? ''
        const mimeType = MIME_BY_EXTENSION[ext] ?? 'image/jpeg'
        const dataUrl = `data:${mimeType};base64,${data.base64}`
        handleImage(await resizeImage(dataUrl, 612, 792), data.filename)
      } catch {
        // ignore malformed messages
      }
    }

    ws.onerror = () => {
      failed = true
    }

    ws.onclose = () => {
      setOpenUrl(null)
      handleClosed(failed)
      reconnectTimer = setTimeout(
        () => setAttempt((n) => n + 1),
        RECONNECT_DELAY_MS,
      )
    }

    return () => {
      // Closing it here is not a disconnect: drop the handlers first so none reports it.
      ws.onopen = null
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      ws.close()
      clearTimeout(reconnectTimer)
      setOpenUrl((current) => (current === url ? null : current))
    }
  }, [url, attempt])

  if (!active) return 'disconnected'
  if (!port) return 'waiting'
  return openUrl === url ? 'connected' : 'connecting'
}
