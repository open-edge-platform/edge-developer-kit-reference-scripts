// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { logger } from '@/lib/logger'

import { VIDEO_PATHS } from './config'
import { detectVideoFPS, loadFrames } from './ffmpeg'
import type { VideoCache } from './types'

interface LoadingState {
  idleMain: boolean
  idleAlternates: boolean
  talking: boolean
  waving: boolean
}

export class VideoCacheManager {
  private cache: {
    idleMain: VideoCache | null
    idleAlternates: VideoCache[]
    talking: VideoCache[]
    waving: VideoCache[]
  } = {
    idleMain: null,
    idleAlternates: [],
    talking: [],
    waving: [],
  }

  private loadingState: LoadingState = {
    idleMain: false,
    idleAlternates: false,
    talking: false,
    waving: false,
  }

  getIdleMain(): VideoCache | null {
    return this.cache.idleMain
  }

  getIdleAlternate(index: number): VideoCache | null {
    return this.cache.idleAlternates[index] || null
  }

  getTalking(index: number): VideoCache | null {
    return this.cache.talking[index] || null
  }

  getWaving(index: number): VideoCache | null {
    return this.cache.waving[index] || null
  }

  getIdleAlternateCount(): number {
    return this.cache.idleAlternates.length
  }

  getTalkingCount(): number {
    return this.cache.talking.length
  }

  getWavingCount(): number {
    return this.cache.waving.length
  }

  isReady(): boolean {
    return (
      this.cache.idleMain !== null &&
      this.cache.talking.length > 0 &&
      this.cache.waving.length > 0
    )
  }

  async ensureVideosLoaded(): Promise<void> {
    await Promise.all([
      this.loadIdleMain(),
      this.loadIdleAlternates(),
      this.loadTalking(),
      this.loadWaving(),
    ])
  }

  private async loadIdleMain(): Promise<void> {
    if (!this.cache.idleMain && !this.loadingState.idleMain) {
      this.loadingState.idleMain = true
      try {
        const fps = await detectVideoFPS(VIDEO_PATHS.idle.main)
        const frames = await loadFrames(VIDEO_PATHS.idle.main)
        this.cache.idleMain = { frames, fps }
        logger.log(
          `Loaded main idle video: ${frames.length} frames at ${fps} FPS`,
        )
      } catch (error) {
        logger.error('Error loading main idle video:', error)
      } finally {
        this.loadingState.idleMain = false
      }
    }
  }

  private async loadIdleAlternates(): Promise<void> {
    if (
      this.cache.idleAlternates.length === 0 &&
      !this.loadingState.idleAlternates &&
      VIDEO_PATHS.idle.alternate.length > 0
    ) {
      this.loadingState.idleAlternates = true
      try {
        for (let i = 0; i < VIDEO_PATHS.idle.alternate.length; i++) {
          const videoPath = VIDEO_PATHS.idle.alternate[i]
          const fps = await detectVideoFPS(videoPath)
          const frames = await loadFrames(videoPath)
          this.cache.idleAlternates.push({ frames, fps })
          logger.log(
            `Loaded idle alternate ${i + 1}: ${frames.length} frames at ${fps} FPS`,
          )
        }
      } catch (error) {
        logger.error('Error loading idle alternate videos:', error)
      } finally {
        this.loadingState.idleAlternates = false
      }
    }
  }

  private async loadTalking(): Promise<void> {
    if (this.cache.talking.length === 0 && !this.loadingState.talking) {
      this.loadingState.talking = true
      try {
        for (let i = 0; i < VIDEO_PATHS.talking.length; i++) {
          const videoPath = VIDEO_PATHS.talking[i]
          const fps = await detectVideoFPS(videoPath)
          const frames = await loadFrames(videoPath)
          this.cache.talking.push({ frames, fps })
          logger.log(
            `Loaded talking video ${i + 1}: ${frames.length} frames at ${fps} FPS`,
          )
        }
      } catch (error) {
        logger.error('Error loading talking videos:', error)
      } finally {
        this.loadingState.talking = false
      }
    }
  }

  private async loadWaving(): Promise<void> {
    if (this.cache.waving.length === 0 && !this.loadingState.waving) {
      this.loadingState.waving = true
      try {
        for (let i = 0; i < VIDEO_PATHS.waving.length; i++) {
          const videoPath = VIDEO_PATHS.waving[i]
          const fps = await detectVideoFPS(videoPath)
          const frames = await loadFrames(videoPath)
          this.cache.waving.push({ frames, fps })
          logger.log(
            `Loaded waving video ${i + 1}: ${frames.length} frames at ${fps} FPS`,
          )
        }
      } catch (error) {
        logger.error('Error loading waving videos:', error)
      } finally {
        this.loadingState.waving = false
      }
    }
  }
}
