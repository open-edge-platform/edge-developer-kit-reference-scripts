// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@libsql/client'
import type { SQLiteSchemaHook } from '@payloadcms/db-sqlite'
import { DATA_DIR } from '@/lib/constants'
import { logger } from '@/lib/logger'

/**
 * Deletes legacy settings-template rows (`added: false`) and their data dirs. Production uses a
 * migration; push mode in dev would drop the `added` column first, so this runs before the push,
 * straight against the file. A no-op once the column is gone.
 */
export const deleteLegacyTemplateRows =
  (url: string): SQLiteSchemaHook =>
  async ({ schema }) => {
    const client = createClient({ url })
    try {
      const columns = await client.execute('PRAGMA table_info(`services`);')
      if (!columns.rows.some((row) => row.name === 'added')) return schema

      const templates = await client.execute(
        'SELECT `type`, `instance_id` FROM `services` WHERE COALESCE(`added`, 0) = 0;',
      )
      if (templates.rows.length === 0) return schema

      await client.execute(
        'DELETE FROM `services` WHERE COALESCE(`added`, 0) = 0;',
      )
      for (const row of templates.rows) {
        const type = String(row.type)
        const instanceId = String(row.instance_id)
        fs.rmSync(path.join(DATA_DIR, type, instanceId), {
          recursive: true,
          force: true,
        })
        logger.log(
          `🧹 ${type}: dropped the settings row "${instanceId}" — services are only rows once added`,
        )
      }
    } catch (error) {
      // A database that is not there yet has nothing to clean.
      logger.error('Failed to drop legacy service settings rows:', error)
    } finally {
      client.close()
    }
    return schema
  }
