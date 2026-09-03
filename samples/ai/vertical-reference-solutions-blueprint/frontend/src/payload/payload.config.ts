// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// First: config.yaml -> process.env, before any module below reads it.
import '../lib/kiosk-config-init'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { buildConfig } from 'payload'
import sharp from 'sharp'
import { Applications } from './collections/Applications'
import { Citizens } from './collections/Citizens'
import { FacePhotos } from './collections/FacePhotos'
import { Fines } from './collections/Fines'
import { Licenses } from './collections/Licenses'
import { Payments } from './collections/Payments'
import { Requests } from './collections/Requests'
import { Users } from './collections/Users'
import { Vehicles } from './collections/Vehicles'
import { cmsSecret } from './secret'
import { seedRegistry } from './seed'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    components: {
      // The registration desk is a page of the kiosk app, not a Payload view
      // — it needs a camera and the card reader — so the admin nav carries a
      // link to it rather than hosting it. See ./components/EnrollLink.
      afterNavLinks: ['/components/EnrollLink#EnrollLink'],
    },
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  /**
   * Payload's REST API is served from /cms-api (see src/app/(payload)/cms-api)
   * so it never collides with the kiosk's own /api/* routes. It serves the
   * admin UI and external callers with the kiosk key; the kiosk routes
   * themselves use the Local API (src/app/api/_lib/cms.ts).
   */
  routes: {
    api: '/cms-api',
  },
  collections: [
    Users,
    Citizens,
    FacePhotos,
    Fines,
    Vehicles,
    Licenses,
    Applications,
    Requests,
    Payments,
  ],
  graphQL: { disable: true },
  // Required for the face-photo upload collection: Payload uses it to read
  // image dimensions and to reject a file that is not really an image.
  sharp,
  onInit: async (payload) => {
    await seedRegistry(payload)
  },
  secret: cmsSecret(),
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: sqliteAdapter({
    client: {
      url: process.env.DATABASE_URL ?? 'file:./db.sqlite',
    },
    migrationDir: './src/payload/migrations',
  }),
})
