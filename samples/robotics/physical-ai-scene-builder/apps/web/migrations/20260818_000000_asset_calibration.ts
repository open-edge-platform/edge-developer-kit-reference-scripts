// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres';

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "public"."enum_assets_metadata_collision_strategy" AS ENUM('box', 'none');
    ALTER TABLE "assets"
      ADD COLUMN "metadata_collision_strategy" "enum_assets_metadata_collision_strategy" DEFAULT 'box';
    UPDATE "assets"
      SET "metadata_collision_strategy" = 'box'
      WHERE "metadata_collision_strategy" IS NULL;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "assets" DROP COLUMN "metadata_collision_strategy";
    DROP TYPE "public"."enum_assets_metadata_collision_strategy";
  `);
}
