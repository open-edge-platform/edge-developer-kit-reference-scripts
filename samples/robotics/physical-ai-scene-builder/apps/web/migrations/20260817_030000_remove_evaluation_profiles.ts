// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres';

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "_scenes_v"
      DROP COLUMN IF EXISTS "version_evaluation_profiles";
    ALTER TABLE "scenes"
      DROP COLUMN IF EXISTS "evaluation_profiles";
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "scenes"
      ADD COLUMN IF NOT EXISTS "evaluation_profiles" jsonb;
    ALTER TABLE "_scenes_v"
      ADD COLUMN IF NOT EXISTS "version_evaluation_profiles" jsonb;
  `);
}
