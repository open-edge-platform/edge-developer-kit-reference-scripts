// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { postgresAdapter } from '@payloadcms/db-postgres';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import { buildConfig } from 'payload';
import sharp from 'sharp';

import { AssetArtifacts, Assets, Materials, Projects, Robots, Scenes, Users } from './collections';
import { ensureSo101Seed } from './seed/so101';
// Dependency-free shared module (not the package entry) so Payload's own loaders can import it.
import { MAX_SPLAT_BYTES } from '../../packages/types/src/splat';

/**
 * Largest single upload (splat PLY, mesh, texture). Payload's multipart parser defaults to 20 MB
 * per file and 50 MB per request, below the 500 MB splats the editor and the Assets collection accept,
 * which made saving a scene with a large splat backdrop fail with "File size limit has been
 * reached". The collection hooks still apply their own per-kind checks.
 */
const MAX_UPLOAD_FILE_BYTES = MAX_SPLAT_BYTES;
/** Room for the multipart framing and the `_payload` JSON field next to the file. */
const UPLOAD_REQUEST_OVERHEAD_BYTES = 2 * 1024 * 1024;

const dirname = path.dirname(fileURLToPath(import.meta.url));
const payloadTypesLicenseHeader =
  '// Copyright (C) 2026 Intel Corporation\n// SPDX-License-Identifier: Apache-2.0\n\n';
const localDatabaseBootstrapScript = path.resolve(
  dirname,
  '../../apps/web/scripts/bootstrap-local-db.mjs',
);

function resolvePayloadSecret(): string {
  const configured = process.env.PAYLOAD_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'PAYLOAD_SECRET is required in production. Set it in the environment (see .env.example).',
    );
  }
  return 'development-only-secret';
}

export default buildConfig({
  admin: {
    disable: true,
    user: Users.slug,
  },
  serverURL: process.env.NEXT_PUBLIC_SERVER_URL || undefined,
  collections: [Users, Projects, Scenes, Assets, AssetArtifacts, Materials, Robots],
  editor: lexicalEditor(),
  upload: {
    limits: { fileSize: MAX_UPLOAD_FILE_BYTES },
    requestSizeLimit: MAX_UPLOAD_FILE_BYTES + UPLOAD_REQUEST_OVERHEAD_BYTES,
  },
  secret: resolvePayloadSecret(),
  bin: [{ key: 'bootstrap-local-db', scriptPath: localDatabaseBootstrapScript }],
  onInit: async (payload) => {
    await ensureSo101Seed(payload);
  },
  typescript: {
    // Only `npm run generate:types` (which runs Prettier) writes this file; runtime regeneration
    // rewrote it unformatted and broke `format:check`.
    autoGenerate: false,
    outputFile: path.resolve(dirname, 'payload-types.ts'),
    postProcess: [({ compiledTypes }) => `${payloadTypesLicenseHeader}${compiledTypes}`],
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URI,
    },
  }),
  sharp,
});
