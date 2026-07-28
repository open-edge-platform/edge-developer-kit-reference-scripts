// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'crypto'
import { EventEmitter } from 'node:events'

import { logger } from '@/lib/logger'

import { IDLE_CONFIG } from './config'
import type { IdleVariant, StreamState, VideoState } from './types'

function secureRandom(): number {
  const value = randomBytes(4).readUInt32BE(0)
  return value / 0x100000000
}

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

  getState(): Readonly<StreamState> {
    return { ...this.state }
  }

  getActiveVideo(): VideoState {
    return this.state.activeVideo
  }

  getPendingVideo(): VideoState | null {
    return this.state.pendingVideo
  }

  getCurrentIdleVariant(): IdleVariant {
    return this.state.currentIdleVariant
  }

  getCurrentTalkingVariant(): number {
    return this.state.currentTalkingVariant
  }

  getCurrentWavingVariant(): number {
    return this.state.currentWavingVariant
  }

  requestVideoSwitch(newVideo: VideoState): void {
    if (newVideo !== this.state.activeVideo) {
      this.state.pendingVideo = newVideo
      this.emit('videoSwitchRequest', newVideo)
    }
  }

  executePendingSwitch(): boolean {
    if (this.state.pendingVideo) {
      const newVideo = this.state.pendingVideo
      this.state.activeVideo = newVideo
      this.state.pendingVideo = null

      if (newVideo !== 'talking' && newVideo !== 'waving') {
        this.resetToMainIdle()
      }
      return true
    }
    return false
  }

  selectRandomTalkingVariant(count: number): number {
    this.state.currentTalkingVariant = Math.floor(secureRandom() * count)
    logger.log(`Selected talking variant ${this.state.currentTalkingVariant}`)
    return this.state.currentTalkingVariant
  }

  selectRandomWavingVariant(count: number): number {
    this.state.currentWavingVariant = Math.floor(secureRandom() * count)
    logger.log(`Selected waving variant ${this.state.currentWavingVariant}`)
    return this.state.currentWavingVariant
  }

  shouldSwitchToIdleAlternate(): boolean {
    return (
      this.state.activeVideo === 'idle' &&
      this.state.currentIdleVariant === 'main' &&
      this.state.idleLoopCount >= this.state.nextIdleAlternateLoop
    )
  }

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

  resetToMainIdle(): void {
    this.state.currentIdleVariant = 'main'
    this.state.idleLoopCount = 0
    this.state.nextIdleAlternateLoop = this.generateNextIdleAlternateLoop()
    logger.log(
      `Reset to main idle, next alternate at loop ${this.state.nextIdleAlternateLoop}`,
    )
  }

  incrementIdleLoopCount(): void {
    if (
      this.state.activeVideo === 'idle' &&
      this.state.currentIdleVariant === 'main'
    ) {
      this.state.idleLoopCount++
    }
  }

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

// Registry symbol keeps the singleton stable across HMR module reloads
// without declaring anything on the global namespace.
const STREAM_STATE_MANAGER_KEY = Symbol.for(
  'edge-ai-studio.avatar-stream-state-manager',
)

export function getStreamStateManager(): StreamStateManager {
  const store = globalThis as unknown as Record<
    symbol,
    StreamStateManager | undefined
  >
  return (store[STREAM_STATE_MANAGER_KEY] ??= new StreamStateManager())
}
