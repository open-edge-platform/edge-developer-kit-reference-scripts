// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { buildConfig } from 'payload'
import { initApp } from '@/lib/app-boot'
import { McpServers } from '@/payload/collections/McpServers'
import { Services } from '@/payload/collections/Services'
import { Users } from '@/payload/collections/Users'
import { AppSettings } from '@/payload/globals/AppSettings'
import { SampleSettings } from '@/payload/globals/SampleSettings'
import { deleteLegacyTemplateRows } from '@/payload/legacy-template-rows'
import { migrations } from '@/payload/migrations'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const DATABASE_URL = process.env.DATABASE_URL ?? 'db.sqlite'
const LICENSE_HEADER =
  '// Copyright (C) 2026 Intel Corporation\n// SPDX-License-Identifier: Apache-2.0\n\n'

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Services, McpServers],
  globals: [AppSettings, SampleSettings],
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
    // Every regeneration (`next dev` runs one at start) keeps the header.
    postProcess: [({ compiledTypes }) => LICENSE_HEADER + compiledTypes],
  },
  // Boot: reset run state, sync rows, apply deployment.json, start the
  // health poller (see `lib/app-boot.ts`).
  onInit: initApp,
  // database-adapter-config-start
  db: sqliteAdapter({
    client: { url: DATABASE_URL },
    migrationDir: './src/payload/migrations',
    prodMigrations: migrations,
    beforeSchemaInit: [deleteLegacyTemplateRows(DATABASE_URL)],
  }),
})
