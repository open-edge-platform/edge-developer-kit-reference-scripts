// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { LIPSYNC_PORT } from '@/lib/constants'

export const LIPSYNC_TYPE = 'lipsync' as const

export const LIPSYNC_DESCRIPTION =
  'Real-time digital avatar with synchronized lip movements and natural speech synthesis'

export const LIPSYNC_WORKLOAD = {
  name: LIPSYNC_TYPE,
  type: LIPSYNC_TYPE,
  model: 'wav2lip',
  device: 'cpu',
  port: LIPSYNC_PORT,
  healthUrl: '/healthcheck',
  metadata: { turnServerIp: '' },
}
