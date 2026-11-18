// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres';

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    UPDATE "scenes" AS scene
    SET "project_id" = NULL
    FROM "projects" AS project
    WHERE scene."project_id" = project."id"
      AND project."slug" = 'so101-evaluation'
      AND scene."is_template" = true;

    DELETE FROM "projects" AS project
    WHERE project."slug" = 'so101-evaluation'
      AND NOT EXISTS (
        SELECT 1
        FROM "scenes" AS scene
        WHERE scene."project_id" = project."id"
      );
  `);
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Global SO101 template migration is intentionally irreversible.');
}
