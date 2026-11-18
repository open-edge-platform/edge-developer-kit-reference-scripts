// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres';

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "projects" ALTER COLUMN "owner_id" DROP NOT NULL;
    ALTER TABLE "scenes" ALTER COLUMN "owner_id" DROP NOT NULL;
    ALTER TABLE "asset_artifacts" ALTER COLUMN "owner_id" DROP NOT NULL;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "projects" ALTER COLUMN "owner_id" SET NOT NULL;
    ALTER TABLE "scenes" ALTER COLUMN "owner_id" SET NOT NULL;
    ALTER TABLE "asset_artifacts" ALTER COLUMN "owner_id" SET NOT NULL;
  `);
}
