// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * The kiosk's database binding: which Payload adapter runs, and what it
 * connects to, both read out of config.yaml.
 *
 * `cms.database_url` is the connection string and `cms.database_adapter` picks
 * the driver that opens it; with no adapter configured the URL's scheme
 * decides. Nothing outside this file needs to be told where the database is —
 * a relative `file:` URL lands in KIOSK_DATA_DIR on a packaged kiosk (an
 * .AppImage is a read-only mount) and beside the server in a checkout, which
 * is what every launcher used to hard-code over the operator's setting.
 *
 * SQLite is the only driver the kit ships. DRIVERS below is the one place that
 * changes: install the adapter package and give its entry a `build`. Anything
 * declared without one fails at boot naming the package it needs, rather than
 * silently falling back to a database the operator did not ask for.
 *
 * See docs/configuration.md.
 */
import path from 'node:path'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import type { DatabaseAdapterObj } from 'payload'

const DEFAULT_URL = 'file:./db.sqlite'

type Driver = {
  /** URL schemes that select this driver when DATABASE_ADAPTER is unset. */
  schemes: readonly string[]
  package: string
  build?: (url: string) => DatabaseAdapterObj
}

/** A relative SQLite file belongs in the writable data directory, not in
 *  whatever the server's cwd happens to be. Mirrors ./secret.ts. */
function resolveFileUrl(url: string): string {
  const file = url.slice('file:'.length)
  if (file === '' || path.isAbsolute(file)) return url
  return `file:${path.resolve(process.env.KIOSK_DATA_DIR ?? process.cwd(), file)}`
}

const DRIVERS: Record<string, Driver> = {
  sqlite: {
    // http/ws included: libSQL reaches a remote Turso database over them.
    schemes: ['file:', 'libsql:', 'http:', 'https:', 'ws:', 'wss:'],
    package: '@payloadcms/db-sqlite',
    build: (url) =>
      sqliteAdapter({
        client: { url },
        migrationDir: './src/payload/migrations',
      }),
  },
  postgres: {
    schemes: ['postgres:', 'postgresql:'],
    package: '@payloadcms/db-postgres',
  },
  mongodb: {
    schemes: ['mongodb:', 'mongodb+srv:'],
    package: '@payloadcms/db-mongodb',
  },
}

const names = () => Object.keys(DRIVERS).join(', ')

function driverName(url: string): string {
  const configured = process.env.DATABASE_ADAPTER?.trim().toLowerCase()
  if (configured) {
    if (!(configured in DRIVERS)) {
      throw new Error(
        `cms.database_adapter is "${configured}"; the kiosk knows ${names()}.`,
      )
    }
    return configured
  }

  const scheme = url.toLowerCase()
  for (const [name, driver] of Object.entries(DRIVERS)) {
    if (driver.schemes.some((prefix) => scheme.startsWith(prefix))) return name
  }
  throw new Error(
    `cms.database_url "${url}" starts with no scheme the kiosk recognises — ` +
      `set cms.database_adapter to one of ${names()}, or point it at ${DEFAULT_URL}.`,
  )
}

/** The configured adapter, ready for buildConfig's `db`. */
export function kioskDatabase(): DatabaseAdapterObj {
  const url = (process.env.DATABASE_URL || DEFAULT_URL).trim()
  if (/[\r\n]/.test(url)) throw new Error('cms.database_url contains a line break')

  const name = driverName(url)
  const driver = DRIVERS[name]
  if (!driver.build) {
    throw new Error(
      `cms.database_adapter "${name}" is not built into this kiosk: install ${driver.package}, ` +
        'then wire it into the DRIVERS table in src/payload/db.ts.',
    )
  }
  return driver.build(name === 'sqlite' && url.startsWith('file:') ? resolveFileUrl(url) : url)
}
