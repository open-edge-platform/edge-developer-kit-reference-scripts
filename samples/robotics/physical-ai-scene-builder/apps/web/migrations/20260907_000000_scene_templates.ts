// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres';

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "scenes"
      ADD COLUMN "is_template" boolean DEFAULT false NOT NULL;

    UPDATE "scenes" AS scene
    SET "is_template" = true
    FROM "projects" AS project
    WHERE scene."project_id" = project."id"
      AND project."slug" = 'so101-evaluation'
      AND scene."name" = 'so101';

    CREATE INDEX "scenes_is_template_idx" ON "scenes" USING btree ("is_template");
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX "scenes_is_template_idx";
    ALTER TABLE "scenes"
      DROP COLUMN "is_template";
  `);
}
