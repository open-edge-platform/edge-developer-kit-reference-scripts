// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import net from 'node:net'
import type { BasePayload } from 'payload'
import { UV_PATH } from '@/lib/constants'
import { logger } from '@/lib/logger'
import {
  getStatus,
  listProcesses,
  removeDeadProcess,
  spawnProcess,
  stopProcess,
} from '@/lib/process-handler'
import type { Service } from '@/payload-types'
import { MULTISERVE_REPO_PATH, engine as multiserve_engine } from './data'
import type { MultiserveModel } from './types'

const activeStartControllers = new Map<string, AbortController>()

const activeHealthCheckControllers = new Map<string, AbortController>()

// Coalesces concurrent ensureMultiserveEngine calls per process name
const activeEnsurePromises = new Map<string, Promise<boolean>>()

// Waits for a port to be free using bind test, polling every interval ms
const waitForPortFree = async (
  port: number,
  maxWait = 15_000,
  interval = 500,
): Promise<boolean> => {
  const deadline = Date.now() + maxWait
  while (Date.now() < deadline) {
    const canBind = await new Promise<boolean>((resolve) => {
      const srv = net.createServer()
      srv.once('error', () => resolve(false))
      srv.listen(port, '0.0.0.0', () => {
        srv.close(() => resolve(true))
      })
    })
    if (canBind) return true
    await new Promise((r) => setTimeout(() => r(0), interval))
  }
  return false
}

export function cancelMultiserveStart(serviceType: string): void {
  const startController = activeStartControllers.get(serviceType)
  if (startController) {
    startController.abort()
    activeStartControllers.delete(serviceType)
  }
  const hcController = activeHealthCheckControllers.get(serviceType)
  if (hcController) {
    hcController.abort()
    activeHealthCheckControllers.delete(serviceType)
  }
  activeEnsurePromises.delete(serviceType)
}

const getMultiserveProcessName = (service: Service) => `${service.type}`

const deriveTaskType = (
  modelKey: string,
  serviceModel: Service['models']['default'],
  serviceType: Service['type'],
): string => {
  if (serviceModel.type === 'multimodal') return 'multimodal'
  return modelKey === 'default' ? serviceType : modelKey
}

const isMultiserveRunning = (service: Service): boolean => {
  const processName = getMultiserveProcessName(service)
  return listProcesses().some(
    (p) => p.name === processName && p.status !== 'stopped',
  )
}

const waitForHealthCheck = async (
  port: number,
  processName: string,
  signal?: AbortSignal,
  maxRetries: number = 60,
): Promise<boolean> => {
  const healthUrl = `http://localhost:${port}/v1/health`

  for (let i = 0; i < maxRetries; i++) {
    if (signal?.aborted) {
      logger.log(`Health check for ${processName} aborted`)
      return false
    }

    // Check if the process is still alive
    const status = getStatus(processName)
    if (!status || status.status === 'stopped') {
      logger.error(
        `Process ${processName} died during health check, cleaning up`,
      )
      removeDeadProcess(processName)
      return false
    }

    try {
      const response = await fetch(new URL(healthUrl))
      if (response.ok) {
        const data = await response.json()
        if (data.health?.['llama.cpp'] === 'OK' && data.health?.ovms === 'OK') {
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

    await new Promise((resolve) => setTimeout(() => resolve(0), 2000))
  }

  logger.error('Health check failed after maximum retries')
  return false
}

const downloadModel = async (
  modelConfig: Service['models']['default'],
  taskType: string,
  port: number,
): Promise<boolean> => {
  try {
    const downloadModelURL = `http://localhost:${port}/v1/model/download/unverified`
    const downloadResponse = await fetch(new URL(downloadModelURL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        repo_id: multiserve_engine.getModelName(modelConfig, true),
        task: taskType.replace('-', '_'),
        extra_params: modelConfig.params,
        device: modelConfig.device,
        source: modelConfig.source,
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
    const logFileName = `${taskType}.log`

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
      logger.file(chunk, type, logFileName)
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
  modelConfig: Service['models']['default'],
  backend: string,
  taskType: string,
  port: number,
): Promise<boolean> => {
  try {
    const startModelURL = `http://localhost:${port}/v1/start`
    const body: Record<string, string | number> = {
      repo_id: multiserve_engine.getModelName(modelConfig, true),
      task: taskType.replace('-', '_'),
      device: modelConfig.device,
    }
    if (backend === 'llamacpp') {
      body.context_size = 4096
    } else {
      body.model_path = ''
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

const initializeModel = async (service: Service): Promise<boolean> => {
  const port = service.port
  if (port == null) {
    logger.error(`Service ${service.name} has no port configured`)
    return false
  }
  try {
    const modelStatusURL = `http://localhost:${port}/v1/models`
    const modelStatusResponse = await fetch(new URL(modelStatusURL))
    if (!modelStatusResponse.ok) {
      logger.log(
        'Failed to fetch model status:',
        await modelStatusResponse.text(),
      )
      return false
    }

    const modelsResponse: Record<string, MultiserveModel[]> =
      await modelStatusResponse.json()

    for (const [modelKey, serviceModel] of Object.entries(service.models)) {
      const typedModel = serviceModel as Service['models']['default']
      const backend = typedModel.backend ?? 'openvino'
      const backendKey = backend === 'openvino' ? 'openvino' : 'llamacpp'
      const backendModels = modelsResponse[backendKey] ?? []
      const taskType = deriveTaskType(modelKey, typedModel, service.type)
      const modelInfo = backendModels.find(
        (model) =>
          model.repo_id === serviceModel.name &&
          (serviceModel.quant
            ? model.downloaded.includes(serviceModel.quant)
            : true),
      )

      if (!modelInfo || modelInfo.downloaded.length === 0) {
        logger.log(`Downloading model ${serviceModel.name}...`)
        const downloaded = await downloadModel(typedModel, taskType, port)
        if (!downloaded) {
          logger.error(`Failed to download model ${serviceModel.name}`)
          return false
        }
      }

      logger.log(`Starting model ${serviceModel.name}...`)
      const started = await startModel(typedModel, backend, taskType, port)
      if (!started) {
        logger.error(`Failed to start model ${serviceModel.name}`)
        return false
      }
    }

    return true
  } catch (error) {
    logger.error('Error initializing model:', error)
    return false
  }
}

const startMultiserveServer = async (service: Service) => {
  const serviceModel = service.models.default
  const device = serviceModel.device
  const port = service.port
  if (port == null) {
    logger.error(`Service ${service.name} has no port configured`)
    return
  }
  const processName = getMultiserveProcessName(service)
  const processes = listProcesses()
  logger.info(`Existing processes: ${processes.map((p) => p.name).join(', ')}`)
  if (processes.some((p) => p.name === processName)) {
    logger.log(`${service.name} with already running on this port: ${port}`)
    return
  }

  const existingProcess = processes.find((p) => p.name.includes(service.type))

  const isGPU = device.toLowerCase().startsWith('gpu')
  const gpuIndex = isGPU ? device.split('.')[1] : null
  const existingNameParts = existingProcess
    ? existingProcess.name.split('_')
    : null
  const existingServiceName = existingNameParts ? existingNameParts[0] : null

  if (existingProcess && existingServiceName === service.type && isGPU) {
    logger.log(`Restarting ${service.name} with for GPU ${gpuIndex}`)
    await stopProcess(existingProcess.name)
  }

  const env = { ...process.env }
  if (isGPU && gpuIndex !== null) {
    env.GGML_VK_VISIBLE_DEVICES = gpuIndex
  }

  logger.log(
    `Starting multiserve with for ${service.name} on port ${port}${isGPU ? ` with GPU ${gpuIndex}` : ''}`,
  )
  const command: string[] = []
  const cwd = MULTISERVE_REPO_PATH

  command.push('run', 'app-hybrid.py', '--debug', '--port', `${port}`)

  const logDir = multiserve_engine.getLogsDir(service.type)
  const modelsDir = multiserve_engine.getModelsDir(service.type)
  command.push('--logs-dir', logDir, '--model-dir', modelsDir)

  // Cancel any lingering health check from a previous start attempt
  const prevHcController = activeHealthCheckControllers.get(processName)
  if (prevHcController) {
    prevHcController.abort()
    activeHealthCheckControllers.delete(processName)
  }

  // Wait for port release before starting
  const portFree = await waitForPortFree(port)
  if (!portFree) {
    logger.error(
      `Port ${port} still in use after waiting — cannot start ${processName}`,
    )
    return false
  }

  await spawnProcess(processName, command, {
    cwd: cwd,
    env: env,
    command: UV_PATH,
  })

  const hcController = new AbortController()
  activeHealthCheckControllers.set(processName, hcController)

  const healthCheckPassed = await waitForHealthCheck(
    port,
    processName,
    hcController.signal,
  )

  if (activeHealthCheckControllers.get(processName) === hcController) {
    activeHealthCheckControllers.delete(processName)
  }

  if (!healthCheckPassed) {
    const status = getStatus(processName)
    if (status && status.status !== 'stopped') {
      logger.error('Health check failed, killing the process...')
      await stopProcess(processName)
    } else {
      logger.error('Health check failed and process already dead, cleaning up')
      removeDeadProcess(processName)
    }
    return false
  }
}

const updateServiceStatus = async (
  service: Service,
  status: Service['status'],
  payload: BasePayload,
) => {
  await payload.update({
    collection: 'services',
    id: service.id,
    data: {
      status: status,
    },
  })
}

// Quick non-retrying health probe
const isEngineHealthy = async (port: number): Promise<boolean> => {
  try {
    const url = new URL(`http://localhost:${port}/v1/health`)
    const res = await fetch(url, {
      signal: AbortSignal.timeout(3_000),
    })
    if (!res.ok) return false
    const data = await res.json()
    return data?.health?.['llama.cpp'] === 'OK' && data?.health?.ovms === 'OK'
  } catch {
    return false
  }
}

// Ensures the multiserve engine process is running (without loading a model)
export const ensureMultiserveEngine = async (
  service: Service,
): Promise<boolean> => {
  const processName = getMultiserveProcessName(service)

  // Coalesce concurrent calls
  const existing = activeEnsurePromises.get(processName)
  if (existing) {
    logger.log(
      `ensureMultiserveEngine already in progress for ${processName}, reusing`,
    )
    return existing
  }

  const promise = ensureMultiserveEngineImpl(service)
  activeEnsurePromises.set(processName, promise)

  try {
    return await promise
  } finally {
    if (activeEnsurePromises.get(processName) === promise) {
      activeEnsurePromises.delete(processName)
    }
  }
}

const ensureMultiserveEngineImpl = async (
  service: Service,
): Promise<boolean> => {
  const processName = getMultiserveProcessName(service)

  const { port } = service
  if (port == null) {
    logger.error(`Service ${service.name} has no port configured`)
    return false
  }

  if (isMultiserveRunning(service)) {
    if (await isEngineHealthy(port)) {
      return true
    }

    // Process listed but unhealthy — clean up and respawn
    logger.log(
      `Engine process ${processName} listed but unhealthy, cleaning up…`,
    )
    await stopProcess(processName)
  } else {
    removeDeadProcess(processName)
  }

  await startMultiserveServer(service)
  return isMultiserveRunning(service)
}

// Full service start: engine + model download + model start
export const startMultiserveModel = async (
  service: Service,
  payload: BasePayload,
) => {
  cancelMultiserveStart(service.type)

  const controller = new AbortController()
  activeStartControllers.set(service.type, controller)
  const processName = getMultiserveProcessName(service)

  try {
    await startMultiserveServer(service)
    if (controller.signal.aborted) return

    const result = await initializeModel(service)
    if (controller.signal.aborted) return

    if (!result) {
      updateServiceStatus(service, 'error', payload)
      logger.log(`Failed to initialize ${service.name}, stopping process`)
      await stopProcess(processName)
    }
  } catch (error) {
    if (controller.signal.aborted) return
    updateServiceStatus(service, 'error', payload)
    logger.error(`Error starting model for service ${service.name}:`, error)
    await stopProcess(processName)
  } finally {
    if (activeStartControllers.get(service.type) === controller) {
      activeStartControllers.delete(service.type)
    }
  }
}
