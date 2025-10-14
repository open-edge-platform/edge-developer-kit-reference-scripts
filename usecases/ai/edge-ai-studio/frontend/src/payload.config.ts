// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import path from 'path'
import sharp from 'sharp'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { BasePayload, buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { Users } from './collections/Users'
import { Devices } from './collections/Devices'
import { Workloads } from './collections/Workloads'
import { migrations } from './migrations'
import { init, killAllProcesses } from './lib/processHandler'
import {
  initHealthCheckService,
  stopHealthCheckService,
} from './lib/healthcheck'

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
  collections: [Users, Devices, Workloads],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  onInit: async (payload) => {
    init()
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
