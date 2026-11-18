// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres';

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DELETE FROM "scenes"
    WHERE lower(trim("name")) IN ('starter', 'double pendulum', 'stacking tower');

    UPDATE "scenes" AS scene
    SET "name" = 'so101'
    FROM "projects" AS project
    WHERE scene."id" = 1
      AND scene."project_id" = project."id"
      AND project."slug" = 'so101-evaluation';
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    UPDATE "scenes" AS scene
    SET "name" = 'New scene'
    FROM "projects" AS project
    WHERE scene."id" = 1
      AND scene."project_id" = project."id"
      AND project."slug" = 'so101-evaluation'
      AND scene."name" = 'so101';
  `);
}
