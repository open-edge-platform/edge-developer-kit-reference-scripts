// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * MJPEG Video Streaming Route Handler
 *
 * This route handler streams video files as MJPEG frames with dynamic switching.
 * It preloads multiple videos into memory and uses EventEmitter to switch videos on the fly.
 *
 * Video Types:
 *   - Idle Main: Primary idle animation that loops continuously
 *   - Idle Alternates: Occasional alternate animations (look left, happy expression, etc.)
 *   - Talking: Multiple talking animations, randomly selected when speaking
 *   - Waving: Waving animation
 *
 * Usage:
 *   GET /avatar/api/stream - Stream the current active video
 *   GET /avatar/api/stream?fps=25 - Stream at custom FPS
 *   POST /avatar/api/stream - Request switch between idle and talking videos
 *     Body: { "state": "idle" | "talking" | "waving" }
 *
 * Video switching behavior:
 *   - State changes (idle/talking): Queued and executed at video boundaries for smooth transitions
 *   - Idle variants: Main idle plays most of the time. After 3-8 loops, a random alternate
 *     idle animation may play once before returning to the main idle loop.
 *   - Talking variants: Each time talking state is activated, a random talking video is selected
 *     from the available options for natural variation.
 *
 * The stream uses multipart/x-mixed-replace content type for continuous frame delivery.
 */

import { NextRequest } from 'next/server'
import type { VideoState } from '@/lib/digital-avatar-lite/types'
import { VideoCacheManager } from '@/lib/digital-avatar-lite/video-cache'
import { getStreamStateManager } from '@/lib/digital-avatar-lite/stream-state'
import { MJPEGStreamHandler } from '@/lib/digital-avatar-lite/mjpeg-stream'
import { logger } from '@/utils/logger'

export const runtime = 'nodejs' // EventEmitter requires Node runtime

// Singleton instances
declare global {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  var __avatarVideoCacheManager: VideoCacheManager | undefined
}

const videoCacheManager =
  globalThis.__avatarVideoCacheManager ?? new VideoCacheManager()
if (!globalThis.__avatarVideoCacheManager) {
  globalThis.__avatarVideoCacheManager = videoCacheManager
}

const streamStateManager = getStreamStateManager()

/**
 * GET endpoint for MJPEG video streaming with dynamic video switching
 */
export async function GET(request: NextRequest) {
  try {
    // Get FPS from query params or use default
    const searchParams = request.nextUrl.searchParams
    const requestedFPS = searchParams.get('fps')
      ? parseInt(searchParams.get('fps')!)
      : null

    // Ensure all videos are preloaded
    await videoCacheManager.ensureVideosLoaded()

    // Verify required videos are loaded (alternates are optional)
    if (!videoCacheManager.isReady()) {
      return new Response(
        JSON.stringify({ error: 'Failed to load video frames' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    // Create stream handler and generate stream
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

/**
 * POST endpoint for requesting video state changes
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { state } = body

    if (state !== 'idle' && state !== 'talking' && state !== 'waving') {
      return new Response(
        JSON.stringify({
          error: 'Invalid video selection',
          message: 'Video must be either "idle", "talking", or "waving"',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    // Type assertion after validation
    const selectedVideo = state as VideoState

    // Request video switch through state manager
    streamStateManager.requestVideoSwitch(selectedVideo)

    return new Response(
      JSON.stringify({
        success: true,
        requestedVideo: selectedVideo,
        currentVideo: streamStateManager.getActiveVideo(),
        pendingSwitch: true,
        idleMainCached: videoCacheManager.getIdleMain() !== null,
        idleAlternatesCached: videoCacheManager.getIdleAlternateCount(),
        talkingCached: videoCacheManager.getTalkingCount(),
        wavingCached: videoCacheManager.getWavingCount(),
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
