// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { logger } from '@/lib/logger'

import { DEFAULT_FPS } from './config'
import type { VideoCache, VideoState } from './types'
import type { VideoCacheManager } from './video-cache'
import type { StreamStateManager } from './stream-state'

interface StreamOptions {
  requestedFPS: number | null
}

export class MJPEGStreamHandler {
  private readonly boundary = 'frame'
  private readonly encoder = new TextEncoder()

  constructor(
    private readonly cacheManager: VideoCacheManager,
    private readonly stateManager: StreamStateManager,
  ) {}

  createStream(options: StreamOptions): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start: async (controller) => {
        await this.startStreaming(controller, options)
      },
      cancel: () => {
        logger.log('Stream cancelled by client')
      },
    })
  }

  private async startStreaming(
    controller: ReadableStreamDefaultController<Uint8Array>,
    options: StreamOptions,
  ): Promise<void> {
    let closed = false
    let currentVideo = this.stateManager.getActiveVideo()
    let currentFrameIndex = 0
    let direction = 1

    try {
      while (!closed) {
        const cache = this.getCurrentCache()
        if (!cache || !cache.frames || cache.frames.length === 0) {
          logger.warn('No frames available, waiting...')
          await this.delay(100)
          continue
        }

        const fps = options.requestedFPS || cache.fps || DEFAULT_FPS
        const frameDelay = 1000 / fps
        const frames = cache.frames

        const isAtBoundary = this.isAtBoundary(currentFrameIndex, frames.length)

        if (isAtBoundary) {
          if (this.handlePendingVideoSwitch(currentVideo)) {
            currentVideo = this.stateManager.getActiveVideo()
            currentFrameIndex = 0
            direction = 1
            continue
          }

          if (
            this.handleIdleVariantSwitch(
              currentVideo,
              direction,
              currentFrameIndex,
            )
          ) {
            currentFrameIndex = 0
            direction = 1
            continue
          }
        }

        const frame = frames[currentFrameIndex]
        if (!frame) {
          logger.error(`Frame at index ${currentFrameIndex} is undefined/null`)
          currentFrameIndex = 0
          continue
        }

        this.sendFrame(controller, frame)

        const moveResult = this.moveToNextFrame(
          currentFrameIndex,
          direction,
          frames.length,
          currentVideo,
        )
        currentFrameIndex = moveResult.index
        direction = moveResult.direction

        await this.delay(frameDelay)
      }
    } catch (error) {
      this.handleStreamError(error, controller)
    } finally {
      closed = true
      this.closeController(controller)
    }
  }

  private getCurrentCache(): VideoCache | null {
    const activeVideo = this.stateManager.getActiveVideo()

    if (activeVideo === 'idle') {
      const variant = this.stateManager.getCurrentIdleVariant()
      if (variant === 'main') {
        return this.cacheManager.getIdleMain()
      }
      return (
        this.cacheManager.getIdleAlternate(variant) ||
        this.cacheManager.getIdleMain()
      )
    } else if (activeVideo === 'talking') {
      const variant = this.stateManager.getCurrentTalkingVariant()
      return (
        this.cacheManager.getTalking(variant) ||
        this.cacheManager.getTalking(0) ||
        null
      )
    } else if (activeVideo === 'waving') {
      const variant = this.stateManager.getCurrentWavingVariant()
      return (
        this.cacheManager.getWaving(variant) ||
        this.cacheManager.getWaving(0) ||
        null
      )
    }
    return null
  }

  private isAtBoundary(frameIndex: number, frameCount: number): boolean {
    return (
      frameIndex === 0 ||
      frameIndex === 1 ||
      frameIndex === frameCount - 1 ||
      frameIndex === frameCount - 2
    )
  }

  private handlePendingVideoSwitch(currentVideo: VideoState): boolean {
    const pendingVideo = this.stateManager.getPendingVideo()
    if (pendingVideo && pendingVideo !== currentVideo) {
      if (this.stateManager.executePendingSwitch()) {
        if (pendingVideo === 'talking') {
          this.stateManager.selectRandomTalkingVariant(
            this.cacheManager.getTalkingCount(),
          )
        } else if (pendingVideo === 'waving') {
          this.stateManager.selectRandomWavingVariant(
            this.cacheManager.getWavingCount(),
          )
        }
        return true
      }
    }
    return false
  }

  private handleIdleVariantSwitch(
    currentVideo: VideoState,
    direction: number,
    currentFrameIndex: number,
  ): boolean {
    if (
      currentVideo === 'idle' &&
      this.stateManager.shouldSwitchToIdleAlternate()
    ) {
      const alternateCount = this.cacheManager.getIdleAlternateCount()
      if (this.stateManager.switchToIdleAlternate(alternateCount) >= 0) {
        return true
      }
    }

    if (
      this.stateManager.isOnIdleAlternate() &&
      direction === -1 &&
      currentFrameIndex === 0
    ) {
      this.stateManager.resetToMainIdle()
      return true
    }

    return false
  }

  private sendFrame(
    controller: ReadableStreamDefaultController<Uint8Array>,
    frame: Buffer,
  ): void {
    controller.enqueue(this.encoder.encode(`--${this.boundary}\r\n`))
    controller.enqueue(this.encoder.encode('Content-Type: image/jpeg\r\n'))
    controller.enqueue(
      this.encoder.encode(`Content-Length: ${frame.length}\r\n\r\n`),
    )
    controller.enqueue(frame)
    controller.enqueue(this.encoder.encode('\r\n'))
  }

  private moveToNextFrame(
    currentIndex: number,
    direction: number,
    frameCount: number,
    currentVideo: VideoState,
  ): { index: number; direction: number } {
    let newIndex = currentIndex + direction
    let newDirection = direction

    if (newIndex >= frameCount) {
      newIndex = frameCount - 2
      newDirection = -1
      if (currentVideo === 'idle') {
        this.stateManager.incrementIdleLoopCount()
      }
    } else if (newIndex < 0) {
      newIndex = 1
      newDirection = 1
    }

    return { index: newIndex, direction: newDirection }
  }

  private handleStreamError(
    error: unknown,
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): void {
    if (
      error instanceof Error &&
      (error.message.includes('aborted') || error.message.includes('cancelled'))
    ) {
      logger.log('Stream aborted by client')
    } else {
      logger.error('Error streaming frames:', error)
      try {
        controller.error(error)
      } catch {
        // Controller may already be closed
      }
    }
  }

  private closeController(
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): void {
    try {
      controller.close()
    } catch {
      // Controller may already be closed
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(() => resolve(), ms))
  }

  getBoundary(): string {
    return this.boundary
  }
}
