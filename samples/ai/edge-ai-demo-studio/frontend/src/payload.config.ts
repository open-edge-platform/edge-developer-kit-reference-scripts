// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { type BasePayload, buildConfig } from 'payload'
import sharp from 'sharp'
import { engines } from './engines/_generated/engines'
import {
  getBackendsForService,
  getRecommendedBackendForService,
} from './engines/registry'
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
import { migrations } from './payload/migrations'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

async function inactivateServices(payload: BasePayload) {
  const result = await payload.update({
    collection: 'services',
    where: {
      status: { not_equals: 'inactive' },
    },
    data: {
      status: 'inactive',
    },
  })

  return result
}

async function ensureServicesExist(payload: BasePayload) {
  const existing = await payload.find({
    collection: 'services',
    limit: 100,
  })
  const existingMap = new Map(existing.docs.map((d) => [d.type, d]))
  const serverOS = os.platform() === 'win32' ? 'windows' : 'linux'

  for (const [serviceType, meta] of Object.entries(metaMap)) {
    if (meta.execution.mode === 'none' && !meta.port) {
      logger.log(
        `ℹ️  Skipping auto-creation of ${meta.name} with 'none' execution mode and missing port:`,
      )
      continue
    }

    const modes = getExecutionModes(meta.execution)
    const isEngineBacked = modes.some((m) => m !== 'worker' && m !== 'none')

    let engine: Service['engine'] = 'worker'
    let models: {
      default: { name: string; device: string; backend?: string }
      [k: string]: { name: string; device: string; backend?: string }
    }

    let healthCheck: Service['healthCheck'] | undefined

    if (isEngineBacked) {
      const recommended = getRecommendedBackendForService(
        serviceType as (typeof existing.docs)[0]['type'],
        serverOS,
      )
      const backends = getBackendsForService(
        serviceType as (typeof existing.docs)[0]['type'],
      )
      const targetBackend = recommended ?? backends[0]

      if (targetBackend) {
        const engineId = Object.entries(engines).find(([, eng]) =>
          eng.supportedBackends.some((b) => b.value === targetBackend.value),
        )?.[0]
        engine = (engineId ?? 'worker') as Service['engine']
        const serviceModels = targetBackend.models[
          serviceType as keyof typeof targetBackend.models
        ] as { name: string; device: string; backend?: string }[] | undefined
        models = {
          default: serviceModels?.[0] ?? { name: 'default', device: 'CPU' },
        }
      } else {
        models = { default: { name: 'default', device: 'CPU' } }
      }

      if (isEngineBacked && targetBackend && targetBackend.healthcheck) {
        healthCheck = targetBackend.healthcheck
      }
    } else {
      models = {
        default: meta.defaultModel ?? { name: 'default', device: 'CPU' },
      }
      if (meta.healthCheck) {
        healthCheck = meta.healthCheck
      }
    }

    const newData = {
      name: meta.name,
      type: serviceType as (typeof existing.docs)[0]['type'],
      port: meta.port,
      engine,
      models,
      healthCheck,
      status: 'inactive' as const,
    }

    const existingService = existingMap.get(
      serviceType as (typeof existing.docs)[0]['type'],
    )

    if (existingService) {
      const fieldsToCheck = ['port', 'engine', 'healthCheck'] as const
      const hasModels = Boolean(existingService.models?.default?.name)
      const needsUpdate =
        !hasModels ||
        fieldsToCheck.some(
          (field) =>
            JSON.stringify(existingService[field]) !==
            JSON.stringify(newData[field]),
        )

      if (needsUpdate) {
        try {
          await payload.update({
            collection: 'services',
            id: existingService.id,
            // Preserve the user's saved models when present; otherwise seed
            // them from the static default.
            data: hasModels
              ? { ...newData, models: existingService.models }
              : newData,
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
  stopHealthCheckService()
  await killAllProcesses()
  process.exit(0)
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

    // Initialize health check service with 10 second interval
    initHealthCheckService(payload)

    // Register signal handlers only once — onInit may be called multiple
    // times during Next.js hot-module reloads, which would otherwise stack
    // duplicate listeners and cause concurrent cleanup races.
    if (!globalThis._appSignalHandlersRegistered) {
      globalThis._appSignalHandlersRegistered = true

      process.on('beforeExit', async (code) => {
        await gracefulShutdown(`Process beforeExit event with code: ${code}`)
      })

      // NOTE: The 'exit' event is synchronous — async operations cannot run
      // inside it, so cleanup must happen in the signal/beforeExit handlers.

      process.on(
        'SIGINT',
        async () => await gracefulShutdown('SIGINT received (Ctrl+C)'),
      )
      process.on(
        'SIGTERM',
        async () => await gracefulShutdown('SIGTERM received'),
      )
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
  // database-adapter-config-end
  sharp,
})
