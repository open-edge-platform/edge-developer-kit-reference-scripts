// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import os from 'os'
import path from 'path'

import type { IdleConfig, VideoPaths } from './types'

export const DEFAULT_FPS = 30

export const IDLE_CONFIG: IdleConfig = {
  minLoopsBeforeAlternate: 3,
  maxLoopsBeforeAlternate: 5,
}

const isWindows = os.platform() === 'win32'

const THIRDPARTY_FFMPEG_DIR = path.join(
  process.cwd(),
  '../',
  'thirdparty',
  'ffmpeg',
  'bin',
)

export const FFMPEG_PATH = isWindows
  ? path.join(THIRDPARTY_FFMPEG_DIR, 'ffmpeg.exe')
  : path.join(THIRDPARTY_FFMPEG_DIR, 'ffmpeg')

export const FFPROBE_PATH = isWindows
  ? path.join(THIRDPARTY_FFMPEG_DIR, 'ffprobe.exe')
  : path.join(THIRDPARTY_FFMPEG_DIR, 'ffprobe')

const AVATAR_DATA_DIR = path.join(
  process.cwd(),
  'public',
  'data',
  'digital-avatar-lite',
)

export const VIDEO_PATHS: VideoPaths = {
  idle: {
    main: path.join(AVATAR_DATA_DIR, 'robot_idle.mp4'),
    alternate: [],
  },
  talking: [path.join(AVATAR_DATA_DIR, 'robot_talking_1.mp4')],
  waving: [path.join(AVATAR_DATA_DIR, 'robot_waving.mp4')],
}
