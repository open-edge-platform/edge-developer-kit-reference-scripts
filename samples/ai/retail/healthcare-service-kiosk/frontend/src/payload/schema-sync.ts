// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { Payload } from 'payload'

type SqliteAdapter = {
  name?: string
  client?: { execute(sql: string): Promise<{ rows: Record<string, unknown>[] }> }
  tables?: Record<string, SQLiteTable>
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`

/**
 * Payload alters the database only on a dev boot (there are no migrations),
 * so under `next start` a field added after the database was made has no
 * column and every read of its collection fails. Nullable columns are added
 * here in place; anything else is reported for a dev boot or a fresh
 * database to settle.
 */
export async function addMissingColumns(payload: Payload): Promise<void> {
  const db = payload.db as unknown as SqliteAdapter
  if (db.name !== 'sqlite' || !db.client || !db.tables) return

  for (const table of Object.values(db.tables)) {
    const { name, columns } = getTableConfig(table)
    const present = await db.client.execute(`PRAGMA table_info(${quote(name)})`)
    if (present.rows.length === 0) {
      payload.logger.warn(`[schema] table ${name} is missing — boot once in dev mode, or start from a fresh database.`)
      continue
    }
    const have = new Set(present.rows.map((row) => String(row.name)))
    for (const column of columns) {
      if (have.has(column.name)) continue
      if (column.notNull) {
        payload.logger.warn(`[schema] ${name}.${column.name} is required and missing — boot once in dev mode to add it.`)
        continue
      }
      await db.client.execute(
        `ALTER TABLE ${quote(name)} ADD COLUMN ${quote(column.name)} ${column.getSQLType()}`,
      )
      payload.logger.info(`[schema] added ${name}.${column.name}`)
    }
  }
}
