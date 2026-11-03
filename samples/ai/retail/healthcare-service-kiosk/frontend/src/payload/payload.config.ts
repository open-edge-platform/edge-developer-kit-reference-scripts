// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// First: config.yaml -> process.env, before any module below reads it.
import '../lib/kiosk-config-init'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildConfig } from 'payload'
import sharp from 'sharp'
import { Applications } from './collections/Applications'
import { Citizens } from './collections/Citizens'
import { FacePhotos } from './collections/FacePhotos'
import { Payments } from './collections/Payments'
import { Requests } from './collections/Requests'
import { Users } from './collections/Users'
import { kioskDatabase } from './db'
import { addMissingColumns } from './schema-sync'
import { cmsSecret } from './secret'
import { seedRegistry } from './seed'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    components: {
      // The registration desk and the settings page are pages of the kiosk
      // app, not Payload views — one needs a camera and the card reader, the
      // other edits a file and restarts the server — so the admin nav carries
      // links to them rather than hosting them. See ./components/EnrollLink.
      afterNavLinks: [
        '/components/StaffLink#StaffLink',
        '/components/EnrollLink#EnrollLink',
        '/components/SettingsLink#SettingsLink',
        '/components/DemoVisitLink#DemoVisitLink',
      ],
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
    Applications,
    Requests,
    Payments,
  ],
  graphQL: { disable: true },
  // Required for the face-photo upload collection: Payload uses it to read
  // image dimensions and to reject a file that is not really an image.
  sharp,
  onInit: async (payload) => {
    await addMissingColumns(payload)
    await seedRegistry(payload)
  },
  secret: cmsSecret(),
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: kioskDatabase(),
})
