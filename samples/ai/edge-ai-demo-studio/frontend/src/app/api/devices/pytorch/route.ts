// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'
import { UV_PATH, WORKER_DIR } from '@/lib/constants'
import { createJsonDeviceQueryHandler } from '../query-devices'

const scriptPath = path.join(WORKER_DIR, 'helper', 'pytorch_device.py')
const cwd = path.join(WORKER_DIR, 'helper')

export const GET = createJsonDeviceQueryHandler(
  scriptPath,
  cwd,
  UV_PATH,
  'PyTorch',
)
