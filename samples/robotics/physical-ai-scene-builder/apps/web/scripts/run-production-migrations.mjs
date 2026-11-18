// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import nodeModule from 'node:module';
import payload, { readMigrationFiles } from 'payload';

if (typeof nodeModule.registerHooks === 'function') nodeModule.registerHooks = undefined;

const { tsImport } = await import('tsx/esm/api');
const configModule = await tsImport('/app/payload/src/payload.config.ts', import.meta.url);
const config = configModule.default ?? configModule;

process.env.PAYLOAD_MIGRATING = 'true';

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

const DEVELOPMENT_DATA_MIGRATIONS = new Set([
  '20260821_000000_so101_sample_scene',
  '20260907_010000_global_so101_template',
]);

async function executeRaw(raw) {
  return payload.db.execute({ drizzle: payload.db.drizzle, raw });
}

async function tableExists(tableName) {
  const result = await executeRaw(`SELECT to_regclass('public."${tableName}"') AS "exists"`);
  return Boolean(result.rows[0]?.exists);
}

async function reconcileDevelopmentSchema(migrations) {
  if (!(await tableExists('payload_migrations'))) return;

  const result = await executeRaw('SELECT "name", "batch" FROM "payload_migrations"');
  const hasDevelopmentMarker = result.rows.some(
    (row) => row.name === 'dev' && Number(row.batch) === -1,
  );
  if (!hasDevelopmentMarker) return;

  if (!(await tableExists('assets'))) {
    throw new Error(
      'The database has a development migration marker but no assets table; refusing to migrate noninteractively.',
    );
  }

  payload.logger.info(
    'Detected a schema pushed by local development; recording the packaged migrations as applied.',
  );
  await executeRaw('DELETE FROM "payload_migrations" WHERE "name" = \'dev\' AND "batch" = -1');
  for (const migration of migrations) {
    if (DEVELOPMENT_DATA_MIGRATIONS.has(migration.name)) continue;
    await executeRaw(
      `INSERT INTO "payload_migrations" ("name", "batch")
       SELECT ${sqlLiteral(migration.name)}, 0
       WHERE NOT EXISTS (
         SELECT 1 FROM "payload_migrations" WHERE "name" = ${sqlLiteral(migration.name)}
       )`,
    );
  }
}

try {
  await payload.init({
    config,
    disableOnInit: true,
  });
  const migrations = await readMigrationFiles({ payload });
  await reconcileDevelopmentSchema(migrations);
  await payload.db.migrate();
} finally {
  await payload.destroy();
}

process.exit(0);
