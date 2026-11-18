// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres';

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "assets"
      ADD COLUMN IF NOT EXISTS "object_model_bundle_id" varchar,
      ADD COLUMN IF NOT EXISTS "object_model_mjcf" varchar,
      ADD COLUMN IF NOT EXISTS "object_model_files" jsonb;
    CREATE INDEX IF NOT EXISTS "assets_object_model_object_model_bundle_id_idx"
      ON "assets" USING btree ("object_model_bundle_id");
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS "assets_object_model_object_model_bundle_id_idx";
    ALTER TABLE "assets"
      DROP COLUMN IF EXISTS "object_model_bundle_id",
      DROP COLUMN IF EXISTS "object_model_mjcf",
      DROP COLUMN IF EXISTS "object_model_files";
  `);
}
