// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Workload } from '@/payload-types'
import { CollectionAfterChangeHook, CollectionAfterDeleteHook } from 'payload'
import { spawnProcess, stopProcess } from '@/lib/processHandler'
import path from 'path'
import { TEXT_TO_SPEECH_PORT, WORKER_DIR } from '@/lib/constants'

export const deleteWorkloadAfterDelete: CollectionAfterDeleteHook<
  Workload
> = async ({ doc }) => {
  const processName = `${doc.name}_${doc.id}`

  try {
    await stopProcess(processName)
  } catch (error) {
    console.error(`Error stopping process for workload ${processName}:`, error)
  }
  return doc
}

const typeHandlers: Record<
  string,
  (doc: Workload) => { params: string } | undefined
> = {
  'speech-to-text': (doc) => ({
    params: `--stt-model-id ${doc.model} --stt-device ${doc.device} --denoise-model-id ${doc.metadata?.denoise_model} --denoise-device ${doc.metadata?.denoise_device} --port ${doc.port}`,
  }),
  embedding: (doc) => {
    return {
      params: `--embedding-model-id ${doc.model} --embedding-device ${doc.device} --reranker-model-id ${doc.metadata?.rerankerModel} --reranker-device ${doc.metadata?.rerankerDevice} --port ${doc.port}`,
    }
  },
  'text-generation': (doc) => ({
    params: `--model-id ${doc.model} --port ${doc.port} --device ${doc.device}`,
  }),
  'text-to-speech': (doc) => ({
    params: `--port ${doc.port} --device ${doc.device}`,
  }),
  lipsync: (doc) => {
    let params = `--port ${doc.port} --tts_port ${TEXT_TO_SPEECH_PORT} --device ${doc.device}`

    // Add turn server IP if provided in metadata
    if (doc.metadata?.turnServerIp) {
      params += ` --turn_server ${doc.metadata.turnServerIp}`
    }

    return { params }
  },
}

const pathHandler = (doc: Workload) => {
  switch (doc.type) {
    case 'text-to-speech':
      return path.join(WORKER_DIR, doc.type, doc.model)
    default:
      return path.join(WORKER_DIR, doc.type)
  }
}

const startProcess = async (workload: Workload) => {
  // Assume all workers uses uv
  const processName = `${workload.name}_${workload.id}`

  const handler = typeHandlers[workload.type]
  const handlerResult = handler ? handler(workload) : undefined
  const params = handlerResult ? handlerResult.params : ''

  await spawnProcess(
    processName,
    'uv',
    ['run', 'main.py', ...params.split(' ')],
    {
      cwd: pathHandler(workload),
    },
  )
}

export const afterWorkloadChange: CollectionAfterChangeHook<Workload> = async ({
  doc,
  operation,
  req: { payload },
}) => {
  const processName = `${doc.name}_${doc.id}`
  if (operation === 'update') {
    const status = doc.status
    switch (status) {
      case 'inactive':
        // Stop the process if it is active
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
        await startProcess(doc)
        return
      default:
        return
    }
  } else {
    if (doc.status !== 'inactive') await startProcess(doc)
  }
}
