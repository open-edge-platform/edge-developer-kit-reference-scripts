// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres';

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TYPE "public"."enum_assets_metadata_collision_strategy"
      ADD VALUE IF NOT EXISTS 'convex-hull';
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Postgres can't drop an enum value, so recreate the type. The column default references the
  // old type and must be dropped before the column type changes, then restored afterwards.
  await db.execute(sql`
    UPDATE "assets"
      SET "metadata_collision_strategy" = 'box'
      WHERE "metadata_collision_strategy" = 'convex-hull';
    ALTER TABLE "assets"
      ALTER COLUMN "metadata_collision_strategy" DROP DEFAULT;
    ALTER TYPE "public"."enum_assets_metadata_collision_strategy"
      RENAME TO "enum_assets_metadata_collision_strategy_old";
    CREATE TYPE "public"."enum_assets_metadata_collision_strategy"
      AS ENUM('box', 'none');
    ALTER TABLE "assets"
      ALTER COLUMN "metadata_collision_strategy"
      TYPE "public"."enum_assets_metadata_collision_strategy"
      USING "metadata_collision_strategy"::text::"public"."enum_assets_metadata_collision_strategy";
    ALTER TABLE "assets"
      ALTER COLUMN "metadata_collision_strategy" SET DEFAULT 'box';
    DROP TYPE "public"."enum_assets_metadata_collision_strategy_old";
  `);
}
