// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { EMBEDDING_WORKLOAD } from '@/lib/workloads/embedding'
import { LIPSYNC_WORKLOAD } from '@/lib/workloads/lipsync'
import { SPEECH_TO_TEXT_WORKLOAD } from '@/lib/workloads/speech-to-text'
import { TEXT_GENERATION_WORKLOAD } from '@/lib/workloads/text-generation'
import { TEXT_TO_SPEECH_WORKLOAD } from '@/lib/workloads/text-to-speech'
import { Workload } from '@/payload-types'

export const createResponse = <T>(
  status: boolean,
  message: string,
  data?: T,
) => {
  return Response.json({
    success: status,
    message: message,
    data: data,
  })
}

export const statusMap = {
  prepare: { status: 'Preparing', color: 'bg-yellow-500' },
  restart: { status: 'Restarting', color: 'bg-yellow-500' },
  active: { status: 'Online', color: 'bg-green-500' },
  inactive: { status: 'Offline', color: 'bg-gray-300' },
  error: { status: 'Error', color: 'bg-red-500' },
}

export function getDefaultWorkload(workloadType: Workload['type']) {
  switch (workloadType) {
    case 'text-generation':
      return TEXT_GENERATION_WORKLOAD
    case 'text-to-speech':
      return TEXT_TO_SPEECH_WORKLOAD
    case 'lipsync':
      return LIPSYNC_WORKLOAD
    case 'embedding':
      return EMBEDDING_WORKLOAD
    case 'speech-to-text':
      return SPEECH_TO_TEXT_WORKLOAD
    default:
      return null
  }
}
