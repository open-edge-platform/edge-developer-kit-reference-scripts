// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Server-only repository paths, from the working directory (always `frontend/`). Never derive them
 * from `__dirname`: it points into the bundler's chunk output, whose depth varies.
 */

import path from 'node:path'

export const REPO_ROOT = path.resolve(process.cwd(), '..')
export const WORKER_DIR = path.join(REPO_ROOT, 'workers')
export const MODELS_DIR = path.join(REPO_ROOT, 'models')
export const LOGS_DIR = path.join(REPO_ROOT, 'logs')
/** Per-instance writable state: `<repo>/data/<type>/<instanceId>`. */
export const DATA_DIR = path.join(REPO_ROOT, 'data')
export const UV_PATH = path.join(
  WORKER_DIR,
  `thirdparty/uv/${process.platform === 'win32' ? 'uv.exe' : 'uv'}`,
)
