// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { type BasePayload, buildConfig } from 'payload'
import { engines } from './engines/_generated/engines'
import {
  getBackendByValue,
  getRecommendedBackendForService,
} from './engines/registry'
import { applyDeploymentConfig } from './lib/deployment-config'
import { generateDeploymentDocs } from './lib/deployment-docs'
import {
  initHealthCheckService,
  stopHealthCheckService,
} from './lib/healthcheck'
import { logger } from './lib/logger'
import { checkAndHandlePortConflicts } from './lib/port-checker'
import { init, killAllProcesses } from './lib/process-handler'
import { McpServers } from './payload/collections/McpServers'
import { Services } from './payload/collections/Services'
import { Users } from './payload/collections/Users'
import { AppSettings } from './payload/globals/AppSettings'
import type { Service } from './payload-types'
import { metaMap } from './services/_generated/meta'
import { getExecutionModes } from './services/types'
import type { OS } from './types/common'
import { migrations } from './payload/migrations'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

async function inactivateServices(payload: BasePayload) {
  const result = await payload.update({
    collection: 'services',
    where: {
      or: [
        { status: { not_equals: 'inactive' } },
        { isHealthy: { equals: true } },
      ],
    },
    data: {
      status: 'inactive',
      isHealthy: false,
    },
  })

  return result
}

const FALLBACK_MODEL: Service['models']['default'] = {
  name: 'default',
  device: 'CPU',
}

type SeedData = {
  engine: Service['engine']
  models: Service['models']
  healthCheck?: Service['healthCheck']
}

function canonicalizeModel(
  model: Service['models']['default'],
): Service['models']['default'] {
  if (model.backend !== 'llamacpp' || !model.quant) return model
  const { quant, ...rest } = model
  if (model.name.endsWith(`:${quant}`)) return rest
  return { ...rest, name: engines.multiserve.getModelName(model) }
}

function resolveEngineBackedSeedData(
  serviceType: Service['type'],
  savedModel: Service['models']['default'] | undefined,
  serverOS: OS,
): SeedData {
  const savedBackend = savedModel?.backend
    ? getBackendByValue(savedModel.backend)
    : undefined
  const backend =
    (savedBackend?.supportedServices.includes(serviceType)
      ? savedBackend
      : undefined) ?? getRecommendedBackendForService(serviceType, serverOS)

  if (!backend) {
    return { engine: 'worker', models: { default: FALLBACK_MODEL } }
  }

  const engineId = Object.entries(engines).find(([, eng]) =>
    eng.supportedBackends.some((b) => b.value === backend.value),
  )?.[0]

  return {
    engine: (engineId ?? 'worker') as Service['engine'],
    models: {
      default: canonicalizeModel(
        backend.models[serviceType]?.[0] ?? FALLBACK_MODEL,
      ),
    },
    healthCheck: backend.healthcheck ?? undefined,
  }
}

async function ensureServicesExist(payload: BasePayload) {
  const existing = await payload.find({
    collection: 'services',
    limit: 100,
  })
  const existingMap = new Map(existing.docs.map((d) => [d.type, d]))
  const serverOS = os.platform() === 'win32' ? 'windows' : 'linux'

  for (const [key, meta] of Object.entries(metaMap)) {
    const serviceType = key as Service['type']

    if (meta.execution.mode === 'none' && !meta.port) {
      logger.log(
        `ℹ️  Skipping auto-creation of ${meta.name} with 'none' execution mode and missing port:`,
      )
      continue
    }

    const modes = getExecutionModes(meta.execution)
    const isEngineBacked = modes.some((m) => m !== 'worker' && m !== 'none')
    const existingService = existingMap.get(serviceType)

    const seedData: SeedData = isEngineBacked
      ? resolveEngineBackedSeedData(
          serviceType,
          existingService?.models?.default,
          serverOS,
        )
      : {
          engine: 'worker',
          models: { default: meta.defaultModel ?? FALLBACK_MODEL },
          healthCheck: meta.healthCheck,
        }

    const newData = {
      name: meta.name,
      type: serviceType,
      port: meta.port,
      status: 'inactive' as const,
      ...seedData,
    }

    if (existingService) {
      const fieldsToCheck = ['port', 'engine', 'healthCheck'] as const
      const hasModels = Boolean(existingService.models?.default?.name)
      // Preserve the user's saved models when present (canonicalized);
      // otherwise seed them from the static default.
      const preservedModels = hasModels
        ? {
            ...existingService.models,
            default: canonicalizeModel(existingService.models.default),
          }
        : undefined
      const modelsChanged =
        hasModels &&
        JSON.stringify(preservedModels) !==
          JSON.stringify(existingService.models)
      const targetData = preservedModels
        ? { ...newData, models: preservedModels }
        : newData
      const needsUpdate =
        !hasModels ||
        modelsChanged ||
        fieldsToCheck.some(
          (field) =>
            JSON.stringify(existingService[field]) !==
            JSON.stringify(targetData[field]),
        )

      if (needsUpdate) {
        try {
          await payload.update({
            collection: 'services',
            id: existingService.id,
            data: targetData,
          })
          logger.log(
            `🔄 Updated service record: ${meta.name} (${serviceType}) — config changed`,
          )
        } catch (error) {
          logger.log(meta)
          logger.error(
            `Failed to update service record for ${meta.name} (${serviceType}):`,
            error,
          )
        }
      }
      continue
    }

    try {
      await payload.create({
        collection: 'services',
        data: newData,
      })
      logger.log(
        `📦 Auto-created service record: ${meta.name} (${serviceType})`,
      )
    } catch (error) {
      logger.log(meta)
      logger.error(
        `Failed to create service record for ${meta.name} (${serviceType}):`,
        error,
      )
    }
  }
}

declare global {
  var _appShuttingDown: boolean | undefined
  var _appSignalHandlersRegistered: boolean | undefined
}

async function gracefulShutdown(reason: string): Promise<void> {
  if (globalThis._appShuttingDown) return
  globalThis._appShuttingDown = true

  logger.log(reason)
  logger.log('Stopping all hosted services...')
  stopHealthCheckService()
  await killAllProcesses()
  logger.log('All services stopped. Goodbye!')
  process.exit(0)
}

let repeatSignalNoticeShown = false

function handleTerminationSignal(reason: string): void {
  if (globalThis._appShuttingDown) {
    if (!repeatSignalNoticeShown) {
      repeatSignalNoticeShown = true
      logger.log(
        'Shutdown already in progress — further Ctrl+C is ignored so all services can stop cleanly.',
      )
    }
    return
  }
  gracefulShutdown(reason)
}

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Services, McpServers],
  globals: [AppSettings],
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  onInit: async (payload) => {
    init()
    // Check port availability and handle conflicts
    const portCheck = await checkAndHandlePortConflicts()

    if (portCheck.killedPorts.length > 0) {
      logger.log(
        `✅ Cleaned up stale processes on ports: ${portCheck.killedPorts.join(', ')}\n`,
      )
    }

    if (portCheck.conflicts.length > 0) {
      logger.log(
        `⚠️  ${portCheck.conflicts.length} external process(es) detected on required ports.`,
      )
      logger.log('Services on those ports may fail to start.\n')
    }

    await inactivateServices(payload)
    await ensureServicesExist(payload)

    // Apply user presets from deployment.json (if present) on top of the
    // seeded defaults — may auto-start services marked "online".
    await applyDeploymentConfig(payload)

    // Keep the deployment.json reference docs in sync with the registries
    generateDeploymentDocs()

    // Initialize health check service with 10 second interval
    initHealthCheckService(payload)

    if (!globalThis._appSignalHandlersRegistered) {
      globalThis._appSignalHandlersRegistered = true

      process.on('beforeExit', async (code) => {
        await gracefulShutdown(`Process beforeExit event with code: ${code}`)
      })

      process.on('SIGINT', () =>
        handleTerminationSignal('SIGINT received (Ctrl+C)'),
      )
      process.on('SIGTERM', () => handleTerminationSignal('SIGTERM received'))
    }
  },
  // database-adapter-config-start
  db: sqliteAdapter({
    client: {
      url: process.env.DATABASE_URL ?? 'db.sqlite',
    },
    migrationDir: './src/payload/migrations',
    prodMigrations: migrations,
  }),
})
