// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { EMBEDDING_TYPE, EMBEDDING_WORKLOAD } from '@/lib/workloads/embedding'
import {
  IMAGE_GENERATION_TYPE,
  IMAGE_GENERATION_WORKLOAD,
} from '@/lib/workloads/image-generation'
import { LIPSYNC_TYPE, LIPSYNC_WORKLOAD } from '@/lib/workloads/lipsync'
import {
  SPEECH_TO_TEXT_TYPE,
  SPEECH_TO_TEXT_WORKLOAD,
} from '@/lib/workloads/speech-to-text'
import {
  TEXT_GENERATION_TYPE,
  TEXT_GENERATION_WORKLOAD,
} from '@/lib/workloads/text-generation'
import {
  TEXT_TO_SPEECH_TYPE,
  TEXT_TO_SPEECH_WORKLOAD,
} from '@/lib/workloads/text-to-speech'
import {
  WAKE_WORD_DETECTION_TYPE,
  WAKE_WORD_DETECTION_WORKLOAD,
} from '@/lib/workloads/wake-word-detection'
import { Workload } from '@/payload-types'
import { Model } from '@/types/workload'

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

export const getBaseURL = (path?: string) => {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${path ?? ''}`
  }
  return ''
}

export const getModelNameWithQuant = (
  model: Model,
  engine?: Workload['engine'],
): string => {
  if (engine === 'llamacpp') {
    return model.quant ? `${model.name}:${model.quant}` : model.name
  }

  return model.name
}

export const constructModelData = (model: Model) => {
  const modelData: Model = {
    name: model.name,
    device: model.device,
  }
  if (model.source) {
    modelData.source = model.source
  }
  if (model.quant) {
    modelData.quant = model.quant
  }
  if (model.params) {
    modelData.params = model.params
  }
  return modelData
}

export const getModelNameWithPrefix = (
  engine: Workload['engine'],
  model: Model,
) => {
  switch (engine) {
    case 'ovms':
      return 'openvino:' + getModelNameWithQuant(model, engine)
    case 'llamacpp':
      return 'llamacpp:' + getModelNameWithQuant(model, engine)
    default:
      return model.name
  }
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
    case TEXT_GENERATION_TYPE:
      return TEXT_GENERATION_WORKLOAD
    case TEXT_TO_SPEECH_TYPE:
      return TEXT_TO_SPEECH_WORKLOAD
    case LIPSYNC_TYPE:
      return LIPSYNC_WORKLOAD
    case EMBEDDING_TYPE:
      return EMBEDDING_WORKLOAD
    case SPEECH_TO_TEXT_TYPE:
      return SPEECH_TO_TEXT_WORKLOAD
    case IMAGE_GENERATION_TYPE:
      return IMAGE_GENERATION_WORKLOAD
    case WAKE_WORD_DETECTION_TYPE:
      return WAKE_WORD_DETECTION_WORKLOAD
    default:
      return null
  }
}
