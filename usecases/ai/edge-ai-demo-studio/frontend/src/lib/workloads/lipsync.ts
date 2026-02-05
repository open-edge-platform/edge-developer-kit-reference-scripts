// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { LIPSYNC_PORT } from '@/lib/constants'
import { CreateWorkload } from '@/types/workload'

export const LIPSYNC_TYPE = 'lipsync' as const

export const LIPSYNC_DESCRIPTION =
  'Real-time digital avatar with synchronized lip movements and natural speech synthesis'

export const LIPSYNC_URL = '/api/lipsync'

export const LIPSYNC_WORKLOAD: CreateWorkload = {
  name: LIPSYNC_TYPE,
  type: LIPSYNC_TYPE,
  models: {
    default: {
      name: 'wav2lip' as const,
      device: 'cpu' as const,
      source: 'huggingface' as const,
    },
  },
  port: LIPSYNC_PORT,
  healthCheck: { url: '/healthcheck' },
  metadata: { turnServerIp: '' },
  engine: 'custom' as const,
}
