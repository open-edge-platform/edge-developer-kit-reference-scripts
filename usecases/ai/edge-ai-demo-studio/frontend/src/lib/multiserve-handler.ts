// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Workload } from '@/payload-types'
import { listProcesses, spawnProcess, stopProcess } from '@/lib/process-handler'
import { MULTISERVE_REPO_PATH, WORKER_DIR } from './constants'
import { BasePayload } from 'payload'
import {
  getMultiserveLogsDir,
  getMultiserveModelsDir,
} from './engine/multiserve'
import path from 'path'
import { MultiserveModel } from '@/types/multiserve'
import { getModelNameWithQuant } from '@/utils/common'
import { logger } from '@/utils/logger'
import { fileLogger } from '@/utils/file-logger'
import { Model } from '@/types/workload'
import { EMBEDDING_TYPE } from './workloads/embedding'

// Health check function to wait for multiserve to be ready
const waitForHealthCheck = async (
  port: number,
  maxRetries: number = 30,
): Promise<boolean> => {
  const healthUrl = `http://localhost:${port}/v1/health`

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(new URL(healthUrl))
      if (response.ok) {
        const data = await response.json()
        if (data.health === 'OK') {
          logger.log('Multiserve health check passed')
          return true
        } else {
          logger.log(
            `Health check attempt ${i + 1}/${maxRetries} returned unhealthy status, retrying...`,
          )
        }
      }
    } catch {
      logger.log(
        `Health check attempt ${i + 1}/${maxRetries} failed, retrying...`,
      )
    }

    // Wait 2 seconds before retry
    await new Promise((resolve) => setTimeout(() => resolve(0), 2000))
  }

  logger.error('Health check failed after maximum retries')
  return false
}

const downloadModel = async (
  id: number,
  modelConfig: Model,
  engine: Workload['engine'],
  taskType: string,
  port: number,
): Promise<boolean> => {
  try {
    const downloadModelURL = `http://localhost:${port}/v1/api/model/download/unverified?backend=${engine}`
    const downloadResponse = await fetch(new URL(downloadModelURL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        repo_id: getModelNameWithQuant(modelConfig, engine),
        task: taskType.replace('-', '_'),
        extra_params: modelConfig.params,
        device: modelConfig.device,
      }),
    })

    if (!downloadResponse.ok) {
      const errorText = await downloadResponse.text()
      logger.error('Failed to download model:', errorText)
      return false
    }

    if (!downloadResponse.body) {
      return false
    }

    const reader = downloadResponse.body.getReader()
    const decoder = new TextDecoder()
    let hasError = false
    const logFileName = `${taskType}_${engine}_${id}.log`

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      let type = 'INFO'
      if (
        chunk.toLowerCase().includes('error') ||
        chunk.toLowerCase().includes('failed')
      ) {
        type = 'ERROR'
        hasError = true
      }
      fileLogger(logFileName, chunk, type)
    }

    if (hasError) {
      return false
    }

    logger.log(`Model ${modelConfig.name} downloaded successfully`)
    return true
  } catch (error) {
    logger.error('Error downloading model:', error)
    return false
  }
}

const startModel = async (
  modelConfig: Model,
  engine: Workload['engine'],
  taskType: string,
  port: number,
): Promise<boolean> => {
  try {
    const startModelURL = `http://localhost:${port}/v1/start?backend=${engine}`
    const body: Record<string, string | number> = {
      repo_id: getModelNameWithQuant(modelConfig, engine),
      task: taskType.replace('-', '_'),
      device: modelConfig.device,
    }
    if (engine === 'llamacpp') {
      body['context_size'] = 4096
    } else {
      body['model_path'] = ''
    }

    const startResponse = await fetch(new URL(startModelURL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...body,
      }),
    })

    if (!startResponse.ok) {
      logger.error('Failed to start model:', await startResponse.text())
      return false
    }

    logger.log(`Model ${modelConfig.name} started successfully`)
    return true
  } catch (error) {
    logger.error('Error starting model:', error)
    return false
  }
}

// Function to download/start model based on workload
const initializeModel = async (workload: Workload): Promise<boolean> => {
  try {
    // if model not downloaded, download it first
    const modelStatusURL = `http://localhost:${workload.port}/v1/model`
    const modelStatusResponse = await fetch(new URL(modelStatusURL))
    if (!modelStatusResponse.ok) {
      logger.log(
        'Failed to fetch model status:',
        await modelStatusResponse.text(),
      )
      return false
    }

    const models: MultiserveModel[] = await modelStatusResponse.json()

    // Check each workload model and download/start if needed
    for (const [modelKey, workloadModel] of Object.entries(workload.models)) {
      const modelInfo = models.find(
        (model) =>
          model.repo_id === workloadModel.name &&
          (workloadModel.quant
            ? model.downloaded.includes(workloadModel.quant)
            : true),
      )

      if (!modelInfo || modelInfo.downloaded.length === 0) {
        // Model not downloaded, need to download it
        logger.log(`Downloading model ${workloadModel.name}...`)
        const downloaded = await downloadModel(
          workload.id,
          workloadModel,
          workload.engine,
          modelKey === 'default' ? workload.type : modelKey,
          workload.port,
        )
        if (!downloaded) {
          logger.error(`Failed to download model ${workloadModel.name}`)
          return false
        }
      }

      // Start the model
      logger.log(`Starting model ${workloadModel.name}...`)
      const started = await startModel(
        workloadModel,
        workload.engine,
        modelKey === 'default' ? workload.type : modelKey,
        workload.port,
      )
      if (!started) {
        logger.error(`Failed to start model ${workloadModel.name}`)
        return false
      }
    }

    return true
  } catch (error) {
    logger.error('Error initializing model:', error)
    return false
  }
}

export const startMultiserveServer = async (workload: Workload) => {
  const processName = `${workload.name}_${workload.engine}`
  const workloadModel = workload.models.default
  const device = workloadModel.device
  const port = workload.port
  const processes = listProcesses()
  logger.info(`Existing processes: ${processes.map((p) => p.name).join(', ')}`)
  // check if process is already running
  if (processes.some((p) => p.name === processName)) {
    logger.log(
      `${workload.name} with ${workload.engine} backend already running on this port: ${port}`,
    )
    return
  }

  const existingProcess = processes.find((p) => p.name.includes(workload.name))

  const isGPU = device.toLowerCase().startsWith('gpu')
  const gpuIndex = isGPU ? device.split('.')[1] : null
  const existingNameParts = existingProcess
    ? existingProcess.name.split('_')
    : null
  const existingWorkloadName = existingNameParts ? existingNameParts[0] : null
  const existingEngine = existingNameParts
    ? existingNameParts.slice(1).join('_')
    : null

  if (existingProcess && existingWorkloadName === workload.name) {
    if (existingEngine && existingEngine !== workload.engine) {
      await stopProcess(existingProcess.name)
    } else if (workload.engine === 'llamacpp' && isGPU) {
      logger.log(
        `Restarting ${workload.name} with ${workload.engine} backend for GPU ${gpuIndex}`,
      )
      await stopProcess(existingProcess.name)
    } else {
      logger.log(
        `${workload.name} with ${workload.engine} backend already running on port ${port}`,
      )
      return
    }
  }

  const env = { ...process.env }
  if (workload.engine === 'llamacpp' && isGPU && gpuIndex !== null) {
    env.GGML_VK_VISIBLE_DEVICES = gpuIndex
  }

  if (workload.engine === 'llamacpp') {
    env.MULTISERVE_BACKEND = 'llamacpp'
  } else {
    env.MULTISERVE_BACKEND = 'openvino'
  }

  env.HF_TOKEN = process.env.HF_TOKEN || ''

  logger.log(
    `Starting multiserve with ${workload.engine} of ${workload.name} backend on port ${port}${isGPU ? ` with GPU ${gpuIndex}` : ''}`,
  )
  const command = ['run']
  let cwd = MULTISERVE_REPO_PATH

  if (workload.type === EMBEDDING_TYPE) {
    command.push(
      'main.py',
      '--backend',
      `${workload.engine}`,
      `--port`,
      `${port}`,
    )
    cwd = path.join(WORKER_DIR, workload.type)
  } else {
    command.push('app.py', '--headless', '--debug', `--port`, `${port}`)
  }

  const logDir = getMultiserveLogsDir(workload.type)
  const modelsDir = getMultiserveModelsDir(workload.type)
  command.push('--logs-dir', logDir, '--model-dir', modelsDir)

  await spawnProcess(processName, 'uv', command, {
    cwd: cwd,
    env: env,
  })

  // Wait for health check to pass
  const healthCheckPassed = await waitForHealthCheck(port, 5)
  if (!healthCheckPassed) {
    logger.error('Health check failed, killing the process...')
    await stopProcess(processName)
    return false
  }
}

const updateWorkloadStatus = async (
  workload: Workload,
  status: Workload['status'],
  payload: BasePayload,
) => {
  await payload.update({
    collection: 'workloads',
    id: workload.id,
    data: {
      status: status,
    },
  })
}

export const startMultiserveModel = async (
  workload: Workload,
  payload: BasePayload,
) => {
  try {
    await startMultiserveServer(workload)

    const result = await initializeModel(workload)
    if (!result) {
      updateWorkloadStatus(workload, 'error', payload)
      logger.log(`Failed to initialize ${workload.name}`)
    }
  } catch (error) {
    updateWorkloadStatus(workload, 'error', payload)
    logger.error(`Error starting model for workload ${workload.name}:`, error)
  }
}
