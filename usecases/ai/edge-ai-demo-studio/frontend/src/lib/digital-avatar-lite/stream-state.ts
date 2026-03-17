// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Stream state manager for handling video switching and state transitions
 */

import { EventEmitter } from 'node:events'
import type { VideoState, IdleVariant, StreamState } from './types'
import { IDLE_CONFIG } from './config'
import { secureRandom } from '@/lib/utils'
import { logger } from '@/utils/logger'

export class StreamStateManager extends EventEmitter {
  private state: StreamState

  constructor() {
    super()
    this.state = {
      activeVideo: 'idle',
      pendingVideo: null,
      currentIdleVariant: 'main',
      currentTalkingVariant: 0,
      currentWavingVariant: 0,
      idleLoopCount: 0,
      nextIdleAlternateLoop: this.generateNextIdleAlternateLoop(),
    }
  }

  /**
   * Get the current state
   */
  getState(): Readonly<StreamState> {
    return { ...this.state }
  }

  /**
   * Get the active video
   */
  getActiveVideo(): VideoState {
    return this.state.activeVideo
  }

  /**
   * Get the pending video
   */
  getPendingVideo(): VideoState | null {
    return this.state.pendingVideo
  }

  /**
   * Get the current idle variant
   */
  getCurrentIdleVariant(): IdleVariant {
    return this.state.currentIdleVariant
  }

  /**
   * Get the current talking variant
   */
  getCurrentTalkingVariant(): number {
    return this.state.currentTalkingVariant
  }

  /**
   * Get the current waving variant
   */
  getCurrentWavingVariant(): number {
    return this.state.currentWavingVariant
  }

  /**
   * Request a video switch
   */
  requestVideoSwitch(newVideo: VideoState): void {
    if (newVideo !== this.state.activeVideo) {
      this.state.pendingVideo = newVideo
      this.emit('videoSwitchRequest', newVideo)
    }
  }

  /**
   * Execute pending video switch
   */
  executePendingSwitch(): boolean {
    if (this.state.pendingVideo) {
      const newVideo = this.state.pendingVideo
      this.state.activeVideo = newVideo
      this.state.pendingVideo = null

      // When switching away from talking or waving, reset to main idle configuration.
      // Talking and waving variants are selected via their respective helper methods.
      if (newVideo !== 'talking' && newVideo !== 'waving') {
        this.resetToMainIdle()
      }
      return true
    }
    return false
  }

  /**
   * Select a random talking variant
   */
  selectRandomTalkingVariant(count: number): number {
    this.state.currentTalkingVariant = Math.floor(secureRandom() * count)
    logger.log(`Selected talking variant ${this.state.currentTalkingVariant}`)
    return this.state.currentTalkingVariant
  }

  /**
   * Select a random waving variant
   */
  selectRandomWavingVariant(count: number): number {
    this.state.currentWavingVariant = Math.floor(secureRandom() * count)
    logger.log(`Selected waving variant ${this.state.currentWavingVariant}`)
    return this.state.currentWavingVariant
  }

  /**
   * Check if should switch to idle alternate
   */
  shouldSwitchToIdleAlternate(): boolean {
    return (
      this.state.activeVideo === 'idle' &&
      this.state.currentIdleVariant === 'main' &&
      this.state.idleLoopCount >= this.state.nextIdleAlternateLoop
    )
  }

  /**
   * Switch to a random idle alternate
   */
  switchToIdleAlternate(count: number): number {
    if (count > 0) {
      const alternateIndex = Math.floor(secureRandom() * count)
      this.state.currentIdleVariant = alternateIndex
      logger.log(
        `Switching to idle alternate ${alternateIndex} after ${this.state.idleLoopCount} loops`,
      )
      return alternateIndex
    }
    return -1
  }

  /**
   * Reset to main idle
   */
  resetToMainIdle(): void {
    this.state.currentIdleVariant = 'main'
    this.state.idleLoopCount = 0
    this.state.nextIdleAlternateLoop = this.generateNextIdleAlternateLoop()
    logger.log(
      `Reset to main idle, next alternate at loop ${this.state.nextIdleAlternateLoop}`,
    )
  }

  /**
   * Increment idle loop count
   */
  incrementIdleLoopCount(): void {
    if (
      this.state.activeVideo === 'idle' &&
      this.state.currentIdleVariant === 'main'
    ) {
      this.state.idleLoopCount++
    }
  }

  /**
   * Check if currently on idle alternate
   */
  isOnIdleAlternate(): boolean {
    return (
      this.state.activeVideo === 'idle' &&
      this.state.currentIdleVariant !== 'main'
    )
  }

  private generateNextIdleAlternateLoop(): number {
    return Math.floor(
      secureRandom() *
        (IDLE_CONFIG.maxLoopsBeforeAlternate -
          IDLE_CONFIG.minLoopsBeforeAlternate) +
        IDLE_CONFIG.minLoopsBeforeAlternate,
    )
  }

  // Type-safe event emitter methods
  override emit(event: 'videoSwitchRequest', newVideo: VideoState): boolean {
    return super.emit(event, newVideo)
  }

  override on(
    event: 'videoSwitchRequest',
    listener: (newVideo: VideoState) => void,
  ): this {
    return super.on(event, listener)
  }

  override off(
    event: 'videoSwitchRequest',
    listener: (newVideo: VideoState) => void,
  ): this {
    return super.off(event, listener)
  }
}

// Singleton instance
declare global {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  var __avatarStreamStateManager: StreamStateManager | undefined
}

export function getStreamStateManager(): StreamStateManager {
  if (!globalThis.__avatarStreamStateManager) {
    globalThis.__avatarStreamStateManager = new StreamStateManager()
  }
  return globalThis.__avatarStreamStateManager
}
