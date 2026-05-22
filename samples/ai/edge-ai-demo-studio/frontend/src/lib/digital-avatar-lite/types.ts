// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export type VideoState = 'idle' | 'talking' | 'waving'
export type IdleVariant = 'main' | number

export interface VideoCache {
  frames: Buffer[]
  fps: number
}

export interface VideoPaths {
  idle: {
    main: string
    alternate: string[]
  }
  talking: string[]
  waving: string[]
}

export interface StreamState {
  activeVideo: VideoState
  pendingVideo: VideoState | null
  currentIdleVariant: IdleVariant
  currentTalkingVariant: number
  currentWavingVariant: number
  idleLoopCount: number
  nextIdleAlternateLoop: number
}

export interface IdleConfig {
  minLoopsBeforeAlternate: number
  maxLoopsBeforeAlternate: number
}
