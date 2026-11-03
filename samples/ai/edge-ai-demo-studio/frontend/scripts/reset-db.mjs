#!/usr/bin/env node
// biome-ignore-all lint/suspicious/noConsole: This is just for a script
// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Deletes the Payload SQLite database named by DATABASE_URL in .env, with its WAL/SHM files.
 * Run: npm run db:reset
 */

import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const print = (line) => process.stdout.write(`${line}\n`)
// Piped into a reader that stopped early (`| head`): nothing left to say.
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0)
  throw error
})

const _dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(_dirname, '..')

function parseEnv(envPath) {
  if (!existsSync(envPath)) return {}
  return Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split('\n')
      .filter(
        (line) => line.trim() && !line.startsWith('#') && line.includes('='),
      )
      .map((line) => {
        const idx = line.indexOf('=')
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()]
      }),
  )
}

const env = parseEnv(path.join(root, '.env'))
const rawUrl = env.DATABASE_URL ?? 'db.sqlite'

// Strip the "file:" prefix used by libsql/better-sqlite3 URL conventions
const dbRelativePath = rawUrl.replace(/^file:/, '')
const dbPath = path.resolve(root, dbRelativePath)

const filesToDelete = [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]

for (const file of filesToDelete) {
  if (existsSync(file)) {
    rmSync(file)
    print(`Deleted: ${path.relative(root, file)}`)
  }
}

print('Database files removed.')
