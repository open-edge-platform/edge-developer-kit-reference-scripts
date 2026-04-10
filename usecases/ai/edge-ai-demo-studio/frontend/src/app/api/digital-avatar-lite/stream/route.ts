// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { NextRequest } from 'next/server'

import type { VideoState } from '@/lib/digital-avatar-lite/types'
import { VideoCacheManager } from '@/lib/digital-avatar-lite/video-cache'
import { getStreamStateManager } from '@/lib/digital-avatar-lite/stream-state'
import { MJPEGStreamHandler } from '@/lib/digital-avatar-lite/mjpeg-stream'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'

declare global {
  var avatarVideoCacheManager: VideoCacheManager | undefined
}

const videoCacheManager =
  globalThis.avatarVideoCacheManager ?? new VideoCacheManager()
if (!globalThis.avatarVideoCacheManager) {
  globalThis.avatarVideoCacheManager = videoCacheManager
}

const streamStateManager = getStreamStateManager()

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const requestedFPS = searchParams.get('fps')
      ? parseInt(searchParams.get('fps')!)
      : null

    await videoCacheManager.ensureVideosLoaded()

    if (!videoCacheManager.isReady()) {
      return new Response(
        JSON.stringify({ error: 'Failed to load video frames' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        },
      )
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
    logger.error('Error in stream endpoint:', error)
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
}

const VALID_STATES = new Set<VideoState>(['idle', 'talking', 'waving'])

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { state?: string }
    const { state } = body

    if (!state || !VALID_STATES.has(state as VideoState)) {
      return new Response(
        JSON.stringify({
          error: 'Invalid video selection',
          message: 'State must be "idle", "talking", or "waving"',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    const selectedVideo = state as VideoState
    streamStateManager.requestVideoSwitch(selectedVideo)

    return new Response(
      JSON.stringify({
        success: true,
        requestedVideo: selectedVideo,
        currentVideo: streamStateManager.getActiveVideo(),
        pendingSwitch: true,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  } catch (error) {
    logger.error('Error in POST endpoint:', error)
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
}
