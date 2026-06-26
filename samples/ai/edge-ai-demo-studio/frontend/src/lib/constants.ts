// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'
import type { Device } from '@/types/common'

const WORKER_DIR = path.resolve(path.dirname(''), '../workers')
const MODELS_DIR = path.resolve(path.dirname(''), '../models')
const LOGS_DIR = path.resolve(path.dirname(''), '../logs')
const UV_PATH = path.join(
  WORKER_DIR,
  `thirdparty/uv/${process.platform === 'win32' ? 'uv.exe' : 'uv'}`,
)
const ALL_DEVICE_TYPES: Device[] = ['cpu', 'gpu', 'xpu', 'npu']

export { LOGS_DIR, WORKER_DIR, MODELS_DIR, UV_PATH, ALL_DEVICE_TYPES }
