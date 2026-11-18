// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres';

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "materials" ADD COLUMN "texture_id" integer;
    ALTER TABLE "materials"
      ADD CONSTRAINT "materials_texture_id_assets_id_fk"
      FOREIGN KEY ("texture_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;
    CREATE INDEX "materials_texture_idx" ON "materials" USING btree ("texture_id");
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "materials" DROP CONSTRAINT "materials_texture_id_assets_id_fk";
    ALTER TABLE "materials" DROP COLUMN "texture_id";
  `);
}
