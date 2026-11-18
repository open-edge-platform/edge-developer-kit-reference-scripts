// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres';

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "assets"
      ADD COLUMN "material_color" varchar DEFAULT '#9eb4c8',
      ADD COLUMN "material_metallic" numeric DEFAULT 0,
      ADD COLUMN "material_roughness" numeric DEFAULT 0.6;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "assets"
      DROP COLUMN "material_color",
      DROP COLUMN "material_metallic",
      DROP COLUMN "material_roughness";
  `);
}
