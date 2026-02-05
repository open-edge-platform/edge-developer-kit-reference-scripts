// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Workload } from '@/payload-types'
import {
  BasePayload,
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
} from 'payload'
import { spawnProcess, stopProcess } from '@/lib/process-handler'
import path from 'path'
import {
  EMBEDDING_SERVING_PORT,
  TEXT_TO_SPEECH_PORT,
  UV_PATH,
  WORKER_DIR,
} from '@/lib/constants'
import { startMultiserveModel } from '@/lib/multiserve-handler'
import { logger } from '@/utils/logger'
import {
  getMultiserveLogsDir,
  getMultiserveModelsDir,
} from '@/lib/engine/multiserve'
import { getModelNameWithQuant } from '@/utils/common'
import fs from 'fs'

export const deleteWorkloadAfterDelete: CollectionAfterDeleteHook<
  Workload
> = async ({ doc }) => {
  const processName =
    doc.engine === 'custom'
      ? `${doc.name}_${doc.id}`
      : `${doc.name}_${doc.engine}_${doc.id}`

  try {
    await stopProcess(processName)
  } catch (error) {
    logger.error(`Error stopping process for workload ${processName}:`, error)
  }
  return doc
}

const typeHandlers: Record<string, (doc: Workload) => string[] | undefined> = {
  'wake-word-detection': (doc) => [
    '--model',
    doc.models.default.name,
    '--vad-threshold',
    String(doc.metadata?.vadThreshold),
    '--port',
    String(doc.port),
  ],
  'speech-to-text': (doc) => [
    '--stt-model-id',
    doc.models.default.name,
    '--stt-device',
    doc.models.default.device,
    '--denoise-model-id',
    doc.models.denoise.name,
    '--denoise-device',
    doc.models.denoise.device,
    '--port',
    String(doc.port),
    '--source',
    doc.models.default.source || 'huggingface',
  ],
  embeddings: (doc) => {
    const params: string[] = [
      '--embedding-model-id',
      getModelNameWithQuant(doc.models.default, doc.engine),
      '--embedding-device',
      doc.models.default.device,
      '--embedding-source',
      doc.models.default.source || 'huggingface',
    ]
    if (doc.models.default.params) {
      params.push('--embedding-params', doc.models.default.params)
    }
    params.push(
      '--reranker-model-id',
      getModelNameWithQuant(doc.models.rerank, doc.engine),
      '--reranker-device',
      doc.models.rerank.device,
      '--reranker-source',
      doc.models.rerank.source || 'huggingface',
    )
    if (doc.models.rerank.params) {
      params.push('--reranker-params', doc.models.rerank.params)
    }
    params.push(
      '--port',
      String(doc.port),
      '--serving-port',
      String(EMBEDDING_SERVING_PORT),
      '--backend',
      doc.engine,
      '--multiserve-models-dir',
      getMultiserveModelsDir(doc.type),
      '--multiserve-logs-dir',
      getMultiserveLogsDir(doc.type, doc.id),
    )
    return params
  },
  'text-to-speech': (doc) => [
    '--port',
    String(doc.port),
    '--device',
    doc.models.default.device,
    '--source',
    doc.models.default.source || 'huggingface',
  ],
  lipsync: (doc) => {
    const params = [
      '--port',
      String(doc.port),
      '--tts_port',
      String(TEXT_TO_SPEECH_PORT),
      '--device',
      doc.models.default.device,
      '--source',
      doc.models.default.source || 'huggingface',
    ]

    // Add turn server IP if provided in metadata
    if (doc.metadata?.turnServerIp) {
      params.push('--turn_server', doc.metadata.turnServerIp)
    }

    return params
  },
  'image-generation': (doc) => [
    '--model-id',
    doc.models.default.name,
    '--port',
    String(doc.port),
    '--device',
    doc.models.default.device,
    '--source',
    doc.models.default.source || 'huggingface',
  ],
}

const pathHandler = (doc: Workload) => {
  switch (doc.type) {
    case 'text-to-speech':
      return path.join(WORKER_DIR, doc.type, doc.models.default.name)
    default:
      return path.join(WORKER_DIR, doc.type)
  }
}

const startProcess = async (workload: Workload) => {
  // Assume all workers uses uv
  const processName =
    workload.engine === 'custom'
      ? `${workload.name}_${workload.id}`
      : `${workload.name}_${workload.engine}_${workload.id}`
  const handler = typeHandlers[workload.type]
  const params = (handler ? handler(workload) : []) ?? []

  logger.info(
    `Starting process for workload ${processName} with params: ${params.join(' ')}`,
  )
  const processPath = pathHandler(workload)
  if (!processPath || !fs.existsSync(processPath)) {
    throw new Error(`No process path found for workload type ${workload.type}`)
  }

  const env = { ...process.env }
  env['UV_EXE'] = UV_PATH

  await spawnProcess(processName, 'uv', ['run', 'main.py', ...(params || [])], {
    cwd: processPath,
  })
}

const updateWorkloadStatus = async (
  payload: BasePayload,
  id: number,
  status: Workload['status'],
) => {
  await payload.update({
    collection: 'workloads',
    id: id,
    data: {
      status: status,
    },
  })
}

export const afterWorkloadChange: CollectionAfterChangeHook<Workload> = async ({
  doc,
  previousDoc,
  operation,
  req: { payload },
}) => {
  const processName =
    doc.engine === 'custom'
      ? `${doc.name}_${doc.id}`
      : `${doc.name}_${doc.engine}_${doc.id}`

  if (operation === 'update') {
    // if no status change, do nothing
    if (previousDoc.status === doc.status) return
    const status = doc.status
    switch (status) {
      case 'inactive':
        await stopProcess(processName)
        return
      case 'restart':
        await stopProcess(processName)

        //Update to prepare to allow start
        await new Promise((res) => {
          payload
            .update({
              collection: 'workloads',
              id: doc.id,
              data: {
                status: 'prepare',
              },
            })
            .then(() => res(true))
        })
        return
      case 'prepare':
        //Exception for embdding, always use custom start even with multiserve
        try {
          if (doc.type === 'embeddings' || doc.engine === 'custom')
            await startProcess(doc)
          else startMultiserveModel(doc, payload)
        } catch {
          await updateWorkloadStatus(payload, doc.id, 'error')
        }
        return
      default:
        return
    }
  } else {
    if (doc.status !== 'inactive') {
      //Exception for embdding, always use custom start even with multiserve
      try {
        if (doc.type === 'embeddings' || doc.engine === 'custom')
          await startProcess(doc)
        else startMultiserveModel(doc, payload)
      } catch {
        await updateWorkloadStatus(payload, doc.id, 'error')
      }
    }
  }
}
