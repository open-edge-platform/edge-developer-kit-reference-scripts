// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import path from 'path'
import sharp from 'sharp'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { BasePayload, buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { Users } from './collections/Users'
import { Workloads } from './collections/Workloads'
import { migrations } from './migrations'
import { init, killAllProcesses } from './lib/processHandler'
import {
  initHealthCheckService,
  stopHealthCheckService,
} from './lib/healthcheck'
import { checkAndHandlePortConflicts } from './lib/portManager'
import { McpServers } from './collections/McpServers'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

async function inactivateWorkloads(payload: BasePayload) {
  const result = await payload.update({
    collection: 'workloads',
    where: {
      status: { not_equals: 'inactive' },
    },
    data: {
      status: 'inactive',
    },
  })

  return result
}

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Workloads, McpServers],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  onInit: async (payload) => {
    init()
    // Check port availability and handle conflicts
    const portCheck = await checkAndHandlePortConflicts()

    if (portCheck.killedPorts.length > 0) {
      console.log(
        `✅ Cleaned up stale processes on ports: ${portCheck.killedPorts.join(', ')}\n`,
      )
    }

    if (portCheck.conflicts.length > 0) {
      console.log(
        `⚠️  ${portCheck.conflicts.length} external process(es) detected on required ports.`,
      )
      console.log('Services on those ports may fail to start.\n')
    }

    await inactivateWorkloads(payload)

    // Initialize health check service with 10 second interval
    initHealthCheckService(payload)
    console.log('--------------------------------------------')
    console.log('payload init health check')

    process.on('beforeExit', async (code) => {
      console.log('Process beforeExit event with code:', code)
      stopHealthCheckService()
      await killAllProcesses()
      process.exit()
    })

    process.on('exit', async (code) => {
      console.log('Process exit event with code:', code)
      stopHealthCheckService()
      await killAllProcesses()
      process.exit()
    })

    process.on('SIGINT', async () => {
      console.log('SIGINT received (Ctrl+C)')
      stopHealthCheckService()
      await killAllProcesses()
      process.exit()
    })

    process.on('SIGTERM', async () => {
      console.log('SIGTERM received')
      stopHealthCheckService()
      await killAllProcesses()
      process.exit()
    })
  },
  // database-adapter-config-start
  db: sqliteAdapter({
    client: {
      url: process.env.DATABASE_URL ?? 'db.sqlite',
    },
    prodMigrations: migrations,
  }),
  // database-adapter-config-end
  sharp,
})
