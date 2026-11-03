// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { BasePayload } from 'payload'
import { sleep } from '@/lib/async'
import { globalSingleton } from '@/lib/global-singleton'
import { getInstanceProcessName } from '@/lib/instances/instances'
import { getServiceMetadata } from '@/lib/instances/service-metadata'
import { logger } from '@/lib/logger'
import { canBind } from '@/lib/system/can-bind'
import { ensureInstanceDataDir } from '@/lib/workers/instance-runtime'
import { fetchLoopback } from '@/lib/workers/loopback'
import {
  appendProcessLog,
  getStatus,
  listProcesses,
  removeDeadProcess,
  spawnProcess,
  stopProcess,
} from '@/lib/workers/process-handler'
import {
  currentStartupAttempt,
  recordStartupEvent,
  type StartupEvent,
} from '@/lib/workers/startup-telemetry'
import {
  untimedDispatcher,
  type WorkerRequestInit,
} from '@/lib/workers/untimed-dispatcher'
import type { Service } from '@/payload-types'
import { engine as multiserveEngine } from './data'
import { isEngineHealthy } from './diagnosis'
import { followDownload } from './download-progress'
import { readDownloadStream } from './download-stream'
import { getInstanceLogsDir, getModelsDir, MULTISERVE_REPO_PATH } from './paths'
import { splitModelName } from './quant-selection'
import { parseServerArgs } from './server-args'
import type { MultiserveModel } from './types'

type ModelEntry = Service['models']['default']

/** Reports a step of the instance's start to its startup panel; a no-op outside a row's start. */
type StartupReport = (event: StartupEvent) => void

const noReport: StartupReport = () => undefined

// On `globalThis`: routes and hooks are separate bundles in dev, and a start registered by one
// must be cancellable from another.
const activeStartControllers = globalSingleton(
  'multiserveStartControllers',
  () => new Map<string, AbortController>(),
)
const activeHealthCheckControllers = globalSingleton(
  'multiserveHealthCheckControllers',
  () => new Map<string, AbortController>(),
)
/** Coalesces concurrent `ensureMultiserveEngine` calls per process name. */
const activeEnsurePromises = globalSingleton(
  'multiserveEnsurePromises',
  () => new Map<string, Promise<boolean>>(),
)

// A download may run for hours, but never this long without a line: the
// engine reports progress, or a status line while it hashes or converts.
const DOWNLOAD_IDLE_TIMEOUT_MS = 10 * 60_000

// One probe of /v1/health; the loops around it decide how long to keep trying.
const HEALTH_PROBE_TIMEOUT_MS = 5_000
const HEALTH_PROBE_INTERVAL_MS = 2_000
const HEALTH_PROBE_ATTEMPTS = 60

// Listing scans the models directory on disk.
const MODELS_LIST_TIMEOUT_MS = 60_000

// Engine calls use `untimedDispatcher`: Node's default one gives up after 300 s without a response
// or between two chunks (a model start, a silent conversion), whatever the call's signal says.
// Every call is bounded by a signal instead.
const engineInit = (
  signal: AbortSignal,
  init: RequestInit = {},
): WorkerRequestInit => ({ ...init, signal, dispatcher: untimedDispatcher })

const withTimeout = (ms: number, signal?: AbortSignal): AbortSignal =>
  signal
    ? AbortSignal.any([signal, AbortSignal.timeout(ms)])
    : AbortSignal.timeout(ms)

const toEngineTask = (taskType: string) => taskType.replace(/-/g, '_')

/**
 * GET `path` on the engine, resent once if the connection fails before any answer: the pooled
 * keep-alive socket may be one uvicorn closed after its 5 s idle limit, unnoticed while a slow
 * database write held the event loop.
 */
const getFromEngine = async (
  port: number,
  path: string,
  signal: AbortSignal,
): Promise<Response> => {
  try {
    return await fetchLoopback(port, path, engineInit(signal))
  } catch (error) {
    if (signal.aborted) throw error
    logger.warn(`GET ${path} on port ${port} failed, sending it again:`, error)
    return fetchLoopback(port, path, engineInit(signal))
  }
}

/** Waits up to `maxWait` ms for `port` to be free, probing with a bind. */
const waitForPortFree = async (
  port: number,
  maxWait = 15_000,
  interval = 500,
): Promise<boolean> => {
  const deadline = Date.now() + maxWait
  while (Date.now() < deadline) {
    if (await canBind(port)) return true
    await sleep(interval)
  }
  return false
}

/** Cancels a start (and its health wait) for a process name (`type@instanceId`). */
export function cancelMultiserveStart(processName: string): void {
  activeStartControllers.get(processName)?.abort()
  activeStartControllers.delete(processName)
  activeHealthCheckControllers.get(processName)?.abort()
  activeHealthCheckControllers.delete(processName)
  activeEnsurePromises.delete(processName)
}

/**
 * Whether `startMultiserveModel` is still running for a process name: the
 * engine's `/v1/start` returns only once the model is loaded, while
 * `/v1/status` lists a llama.cpp server as soon as it is spawned.
 */
export function isMultiserveStarting(processName: string): boolean {
  return activeStartControllers.has(processName)
}

/**
 * What starting a bare engine (no model) reads from a `services` row. A
 * draft engine (`./draft-engine.ts`) has no row and passes just these.
 */
export type MultiserveEngineTarget = Pick<
  Service,
  'type' | 'instanceId' | 'name' | 'port' | 'metadata'
> & { models: { default: Pick<ModelEntry, 'device'> } }

const deriveTaskType = (
  modelKey: string,
  serviceModel: ModelEntry,
  serviceType: Service['type'],
): string => {
  if (serviceModel.type === 'multimodal') return 'multimodal'
  return modelKey === 'default' ? serviceType : modelKey
}

const isMultiserveRunning = (service: MultiserveEngineTarget): boolean => {
  const processName = getInstanceProcessName(service)
  return listProcesses().some(
    (p) => p.name === processName && p.status !== 'stopped',
  )
}

const waitForHealthCheck = async (
  port: number,
  processName: string,
  signal: AbortSignal,
): Promise<boolean> => {
  for (let i = 0; i < HEALTH_PROBE_ATTEMPTS; i++) {
    if (signal.aborted) {
      logger.log(`Health check for ${processName} aborted`)
      return false
    }

    const status = getStatus(processName)
    if (!status || status.status === 'stopped') {
      logger.error(
        `Process ${processName} died during health check, cleaning up`,
      )
      removeDeadProcess(processName)
      return false
    }

    if (
      await isEngineHealthy(port, withTimeout(HEALTH_PROBE_TIMEOUT_MS, signal))
    ) {
      logger.log(`${processName}: multiserve health check passed`)
      return true
    }
    logger.debug(
      `${processName}: health check attempt ${i + 1}/${HEALTH_PROBE_ATTEMPTS} not healthy yet, retrying…`,
    )
    await sleep(HEALTH_PROBE_INTERVAL_MS)
  }

  logger.error(`${processName}: health check failed after maximum retries`)
  return false
}

const downloadModel = async (
  service: MultiserveEngineTarget,
  modelConfig: ModelEntry,
  taskType: string,
  port: number,
  signal: AbortSignal,
  report: StartupReport = noReport,
): Promise<boolean> => {
  const failed = (reason: string) =>
    report({
      type: 'failure',
      summary: `Could not download "${modelConfig.name}": ${reason}`,
    })
  // Aborted by the start being cancelled, or by the engine going silent.
  const idle = new AbortController()
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const stillAlive = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(
      () =>
        idle.abort(
          new Error(
            `Download sent nothing for ${DOWNLOAD_IDLE_TIMEOUT_MS / 60_000} minutes`,
          ),
        ),
      DOWNLOAD_IDLE_TIMEOUT_MS,
    )
  }
  stillAlive()

  try {
    const downloadResponse = await fetchLoopback(
      port,
      '/v1/model/download/unverified',
      engineInit(AbortSignal.any([signal, idle.signal]), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_id: multiserveEngine.getModelName(modelConfig, true),
          task: toEngineTask(taskType),
          extra_params: modelConfig.params,
          target_device: modelConfig.device,
          source: modelConfig.source,
        }),
      }),
    )

    if (!downloadResponse.ok) {
      logger.error('Failed to download model:', await downloadResponse.text())
      failed(`the engine answered HTTP ${downloadResponse.status}`)
      return false
    }

    if (!downloadResponse.body) {
      return false
    }

    // Into the instance's own log, which its Logs tab shows.
    const processName = getInstanceProcessName(service)
    const follow = followDownload(modelConfig.name, {
      report,
      // Only the log level; success is the result line's alone.
      log: (line) =>
        appendProcessLog(
          processName,
          /^error\b/i.test(line) ? 'error' : 'info',
          line,
        ),
    })
    const result = await readDownloadStream(
      downloadResponse.body,
      (line, lineResult) => {
        stillAlive()
        // A failed result is reported below, as the start's failure.
        if (!lineResult) follow(line)
      },
    )

    if (!result.ok) {
      logger.error(
        `Failed to download model ${modelConfig.name}: ${result.error ?? 'unknown error'}`,
      )
      failed(result.error ?? 'the engine gave no reason')
      return false
    }

    logger.log(`Model ${modelConfig.name} downloaded successfully`)
    return true
  } catch (error) {
    if (signal.aborted) {
      logger.log(`Download of ${modelConfig.name} cancelled`)
      return false
    }
    logger.error('Error downloading model:', idle.signal.reason ?? error)
    if (idle.signal.aborted) {
      failed(
        `the download sent nothing for ${DOWNLOAD_IDLE_TIMEOUT_MS / 60_000} minutes`,
      )
    }
    return false
  } finally {
    clearTimeout(idleTimer)
  }
}

/** What a failed engine call says: FastAPI's `detail`, else the body itself. */
const engineErrorDetail = (body: string): string => {
  try {
    const { detail } = JSON.parse(body) as { detail?: unknown }
    if (typeof detail === 'string') return detail
  } catch {
    // Not JSON: the text is the reason.
  }
  return body.trim()
}

const startModel = async (
  modelConfig: ModelEntry,
  backend: string,
  taskType: string,
  port: number,
  signal: AbortSignal,
  report: StartupReport = noReport,
  serverArgs: string[] = [],
): Promise<boolean> => {
  try {
    const body: Record<string, string | number | string[]> = {
      repo_id: multiserveEngine.getModelName(modelConfig, true),
      task: toEngineTask(taskType),
      device: modelConfig.device,
    }
    if (backend !== 'llamacpp') {
      body.model_path = ''
    }
    if (serverArgs.length > 0) {
      body[
        backend === 'llamacpp' ? 'llamacpp_extra_args' : 'openvino_extra_params'
      ] = serverArgs
    }

    // Loading a model can take minutes; only cancelling the start bounds it.
    const startResponse = await fetchLoopback(
      port,
      '/v1/start',
      engineInit(signal, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )

    if (!startResponse.ok) {
      const detail = engineErrorDetail(await startResponse.text())
      logger.error('Failed to start model:', detail)
      report({
        type: 'failure',
        summary: detail
          ? `The engine could not load "${modelConfig.name}": ${detail}`
          : `The engine could not load "${modelConfig.name}" (HTTP ${startResponse.status})`,
      })
      return false
    }

    logger.log(`Model ${modelConfig.name} started successfully`)
    return true
  } catch (error) {
    if (signal.aborted) {
      logger.log(`Start of ${modelConfig.name} cancelled`)
      return false
    }
    logger.error('Error starting model:', error)
    return false
  }
}

const initializeModel = async (
  service: Service,
  signal: AbortSignal,
  report: StartupReport,
): Promise<boolean> => {
  const port = service.port
  if (port == null) {
    logger.error(`Service ${service.name} has no port configured`)
    return false
  }
  try {
    const modelStatusResponse = await getFromEngine(
      port,
      '/v1/models',
      withTimeout(MODELS_LIST_TIMEOUT_MS, signal),
    )
    if (!modelStatusResponse.ok) {
      logger.error(
        'Failed to fetch model status:',
        await modelStatusResponse.text(),
      )
      return false
    }

    const modelsResponse: Record<string, MultiserveModel[]> =
      await modelStatusResponse.json()

    for (const [modelKey, entry] of Object.entries(service.models)) {
      const serviceModel: ModelEntry = entry
      const backend = serviceModel.backend ?? 'openvino'
      // The instance's server arguments are its main model's.
      const serverArgs = parseServerArgs(
        modelKey === 'default'
          ? (getServiceMetadata(service).serverArgs ?? '')
          : '',
        backend === 'llamacpp' ? 'llamacpp' : 'openvino',
      )
      if (!serverArgs.ok) {
        report({
          type: 'failure',
          summary: `The server arguments cannot be used: ${serverArgs.error}`,
        })
        return false
      }
      const backendKey = backend === 'openvino' ? 'openvino' : 'llamacpp'
      const backendModels = modelsResponse[backendKey] ?? []
      const taskType = deriveTaskType(modelKey, serviceModel, service.type)
      // The engine lists a llama.cpp repo once, with its quants; the saved
      // name carries the quant to run (`<repo>:<QUANT>`).
      const wanted =
        backend === 'llamacpp'
          ? splitModelName(serviceModel.name, serviceModel.quant)
          : { repoId: serviceModel.name, quant: serviceModel.quant }
      const modelInfo = backendModels.find(
        (model) =>
          model.repo_id === wanted.repoId &&
          (wanted.quant ? model.downloaded.includes(wanted.quant) : true),
      )

      if (!modelInfo || modelInfo.downloaded.length === 0) {
        logger.log(`Downloading model ${serviceModel.name}...`)
        // Each file the engine fetches is then a step of its own, with the
        // progress it prints (`./download-progress.ts`).
        report({
          type: 'stage',
          stage: 'downloading',
          detail: serviceModel.name,
        })
        const downloaded = await downloadModel(
          service,
          serviceModel,
          taskType,
          port,
          signal,
          report,
        )
        if (!downloaded) {
          if (!signal.aborted) {
            logger.error(`Failed to download model ${serviceModel.name}`)
          }
          return false
        }
      }

      logger.log(`Starting model ${serviceModel.name}...`)
      report({
        type: 'stage',
        stage: 'loading-model',
        detail: serviceModel.name,
      })
      if (serverArgs.args.length > 0) {
        appendProcessLog(
          getInstanceProcessName(service),
          'info',
          `Server arguments: ${serverArgs.args.join(' ')}`,
        )
      }
      const started = await startModel(
        serviceModel,
        backend,
        taskType,
        port,
        signal,
        report,
        serverArgs.args,
      )
      if (!started) {
        if (!signal.aborted) {
          logger.error(`Failed to start model ${serviceModel.name}`)
        }
        return false
      }
    }

    return true
  } catch (error) {
    logger.error('Error initializing model:', error)
    // Said where the user looks: the instance log and its startup panel
    // otherwise end at "Starting the inference engine".
    if (!signal.aborted) {
      // `fetch failed` says little; its cause names the socket error.
      const reason = error instanceof Error ? (error.cause ?? error) : error
      report({
        type: 'failure',
        summary: `The inference engine did not answer: ${reason instanceof Error ? reason.message : String(reason)}`,
      })
    }
    return false
  }
}

/**
 * Starts the engine process for an instance and waits for its health check. True when the engine
 * is up (started now or already running), false when it could not start.
 */
const startMultiserveServer = async (
  service: MultiserveEngineTarget,
): Promise<boolean> => {
  const device = service.models.default.device
  const port = service.port
  if (port == null) {
    logger.error(`Service ${service.name} has no port configured`)
    return false
  }
  const processName = getInstanceProcessName(service)
  if (listProcesses().some((p) => p.name === processName)) {
    logger.log(`${processName} is already running on port ${port}`)
    return true
  }

  // Each instance owns its own process; sibling instances of the same type
  // are never stopped here.
  const isGPU = device.toLowerCase().startsWith('gpu')
  const gpuIndex = isGPU ? device.split('.')[1] : undefined

  logger.log(
    `Starting multiserve for ${processName} on port ${port}${gpuIndex !== undefined ? ` with GPU ${gpuIndex}` : ''}`,
  )

  // Each instance logs into its own sub-folder; the models directory stays shared so instances
  // never download a model twice.
  const logsDir = getInstanceLogsDir(service)
  const command = [
    '--debug',
    '--port',
    `${port}`,
    '--logs-dir',
    logsDir,
    '--model-dir',
    getModelsDir(service.type),
    // Weights stay shared in the model dir; the live OVMS config.json and
    // the llama.cpp config.yaml live here, one per instance.
    '--instance-dir',
    ensureInstanceDataDir(service),
  ]

  // Cancel any lingering health check from a previous start attempt
  activeHealthCheckControllers.get(processName)?.abort()
  activeHealthCheckControllers.delete(processName)

  if (!(await waitForPortFree(port))) {
    logger.error(
      `Port ${port} still in use after waiting — cannot start ${processName}`,
    )
    return false
  }

  const spawned = await spawnProcess(processName, command, {
    cwd: MULTISERVE_REPO_PATH,
    // spawnProcess builds the rest of the environment. INSTANCE_KEY names the engine in every
    // response (`answeredByOtherInstance`); start.sh maps GGML_VK_VISIBLE_DEVICES to oneAPI's
    // device selector on the SYCL backend.
    env: {
      INSTANCE_KEY: processName,
      ...(gpuIndex !== undefined ? { GGML_VK_VISIBLE_DEVICES: gpuIndex } : {}),
    },
    cpuAffinity: getServiceMetadata(service).cpuAffinity,
    // The model servers' logs: a failed run's stay readable as the
    // previous run once the engine starts again.
    logDir: logsDir,
  })
  if (spawned.kind === 'failed') {
    logger.error(`${processName}: ${spawned.error}`)
    return false
  }

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
  if (healthCheckPassed) return true
  // Cancelled by a stop or a newer start, which own the process now: the
  // newer start may already be reusing it.
  if (hcController.signal.aborted) return false

  const status = getStatus(processName)
  if (status && status.status !== 'stopped') {
    logger.error(`${processName}: health check failed, stopping the process`)
    await stopProcess(processName)
  } else {
    logger.error(
      `${processName}: health check failed and the process already exited`,
    )
    removeDeadProcess(processName)
  }
  return false
}

const markFailed = async (
  service: Service,
  payload: BasePayload,
  statusMessage: string,
) => {
  try {
    await payload.update({
      collection: 'services',
      id: service.id,
      data: { status: 'error', statusMessage },
    })
  } catch (error) {
    logger.error(`Failed to update status for ${service.name}:`, error)
  }
}

/** An engine start's state, for callers that don't wait for it (`POST /api/services/[id]/engine`). */
export const getMultiserveEngineState = async (
  service: MultiserveEngineTarget,
): Promise<{ starting: boolean; healthy: boolean }> => {
  if (activeEnsurePromises.has(getInstanceProcessName(service))) {
    return { starting: true, healthy: false }
  }
  const { port } = service
  const healthy =
    port != null &&
    isMultiserveRunning(service) &&
    (await isEngineHealthy(port))
  return { starting: false, healthy }
}

const ensureMultiserveEngineImpl = async (
  service: MultiserveEngineTarget,
): Promise<boolean> => {
  const processName = getInstanceProcessName(service)

  const { port } = service
  if (port == null) {
    logger.error(`Service ${service.name} has no port configured`)
    return false
  }

  if (isMultiserveRunning(service)) {
    if (await isEngineHealthy(port)) {
      return true
    }

    logger.log(
      `Engine process ${processName} listed but unhealthy, cleaning up…`,
    )
    await stopProcess(processName)
  } else {
    removeDeadProcess(processName)
  }

  return startMultiserveServer(service)
}

/** Ensures the engine process is running, without loading a model. */
export const ensureMultiserveEngine = async (
  service: MultiserveEngineTarget,
): Promise<boolean> => {
  const processName = getInstanceProcessName(service)

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

/**
 * Full service start: engine, then the model's download and start. Steps report under the attempt
 * that began them, so a cancelled start's late steps count for nothing.
 */
export const startMultiserveModel = async (
  service: Service,
  payload: BasePayload,
): Promise<void> => {
  const processName = getInstanceProcessName(service)
  cancelMultiserveStart(processName)
  const attemptId = currentStartupAttempt(processName)
  const report: StartupReport = (event) => {
    if (attemptId) recordStartupEvent(processName, attemptId, event)
  }

  const controller = new AbortController()
  activeStartControllers.set(processName, controller)

  try {
    report({
      type: 'stage',
      stage: 'preparing',
      detail: 'Starting the inference engine',
    })
    const engineUp = await startMultiserveServer(service)
    if (controller.signal.aborted) return
    if (!engineUp) {
      report({
        type: 'failure',
        summary: 'The multiserve engine did not start',
      })
      await markFailed(
        service,
        payload,
        'The multiserve engine did not start — see its log',
      )
      return
    }

    const result = await initializeModel(service, controller.signal, report)
    if (controller.signal.aborted) return
    // Loaded: the health poller's backend check decides when it is running.
    if (result) report({ type: 'stage', stage: 'checking-readiness' })

    if (!result) {
      logger.log(`Failed to initialize ${service.name}, stopping process`)
      await markFailed(
        service,
        payload,
        `Could not download or start "${service.models.default.name}" — see the multiserve log`,
      )
      await stopProcess(processName)
    }
  } catch (error) {
    if (controller.signal.aborted) return
    logger.error(`Error starting model for service ${service.name}:`, error)
    report({
      type: 'failure',
      summary: 'The multiserve engine failed while starting',
    })
    await markFailed(
      service,
      payload,
      'The multiserve engine failed while starting',
    )
    await stopProcess(processName)
  } finally {
    if (activeStartControllers.get(processName) === controller) {
      activeStartControllers.delete(processName)
    }
  }
}
