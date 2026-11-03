// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonError, jsonErrorFrom, parseJsonBody } from '@/lib/api/json'
import { globalSingleton } from '@/lib/global-singleton'
import { MJPEGStreamHandler } from '@/samples/digital-avatar-lite/lib/mjpeg-stream'
import { getStreamStateManager } from '@/samples/digital-avatar-lite/lib/stream-state'
import type { VideoState } from '@/samples/digital-avatar-lite/lib/types'
import { VideoCacheManager } from '@/samples/digital-avatar-lite/lib/video-cache'

export const runtime = 'nodejs'

// Decoding the avatar videos is slow: one cache per process.
const videoCacheManager = globalSingleton(
  'avatarVideoCacheManager',
  () => new VideoCacheManager(),
)

const streamStateManager = getStreamStateManager()

/** Highest frame rate a client may ask for. */
const MAX_FPS = 60

/** The avatar as an MJPEG stream; `?fps=` overrides the videos' frame rate. */
export async function GET(request: NextRequest) {
  const fpsParam = request.nextUrl.searchParams.get('fps')
  let requestedFPS: number | null = null
  if (fpsParam !== null) {
    requestedFPS = Number(fpsParam)
    if (
      !Number.isInteger(requestedFPS) ||
      requestedFPS < 1 ||
      requestedFPS > MAX_FPS
    ) {
      return jsonError(400, `fps must be a whole number from 1 to ${MAX_FPS}`)
    }
  }

  try {
    await videoCacheManager.ensureVideosLoaded()
    if (!videoCacheManager.isReady()) {
      return jsonError(500, 'Failed to load video frames')
    }

    const streamHandler = new MJPEGStreamHandler(
      videoCacheManager,
      streamStateManager,
    )
    const stream = streamHandler.createStream({ requestedFPS })

    return new Response(stream, {
      headers: {
        'Content-Type': `multipart/x-mixed-replace; boundary=${streamHandler.getBoundary()}`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (error) {
    return jsonErrorFrom(error, 'Failed to start the avatar stream')
  }
}

const VALID_STATES = [
  'idle',
  'talking',
  'waving',
] as const satisfies readonly VideoState[]

const switchSchema = z.object({
  state: z.enum(VALID_STATES, {
    error: 'State must be "idle", "talking", or "waving"',
  }),
})

/** `{ state }` switches the avatar's video at the next loop point. */
export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody(request, switchSchema)
  if (!parsed.ok) return parsed.response

  streamStateManager.requestVideoSwitch(parsed.data.state)
  return NextResponse.json({
    success: true,
    requestedVideo: parsed.data.state,
    currentVideo: streamStateManager.getActiveVideo(),
    pendingSwitch: true,
  })
}
