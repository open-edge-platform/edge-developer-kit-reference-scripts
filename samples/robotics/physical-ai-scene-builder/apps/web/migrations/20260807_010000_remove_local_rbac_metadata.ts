// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres';

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_owner_id_users_id_fk";
    ALTER TABLE "scenes" DROP CONSTRAINT IF EXISTS "scenes_owner_id_users_id_fk";
    ALTER TABLE "assets" DROP CONSTRAINT IF EXISTS "assets_owner_id_users_id_fk";
    ALTER TABLE "materials" DROP CONSTRAINT IF EXISTS "materials_owner_id_users_id_fk";
    ALTER TABLE "asset_artifacts" DROP CONSTRAINT IF EXISTS "asset_artifacts_owner_id_users_id_fk";

    DROP INDEX IF EXISTS "projects_owner_idx";
    DROP INDEX IF EXISTS "scenes_owner_idx";
    DROP INDEX IF EXISTS "assets_owner_idx";
    DROP INDEX IF EXISTS "materials_owner_idx";
    DROP INDEX IF EXISTS "asset_artifacts_owner_idx";

    ALTER TABLE "projects" DROP COLUMN IF EXISTS "owner_id";
    ALTER TABLE "scenes" DROP COLUMN IF EXISTS "owner_id";
    ALTER TABLE "assets" DROP COLUMN IF EXISTS "owner_id";
    ALTER TABLE "materials" DROP COLUMN IF EXISTS "owner_id";
    ALTER TABLE "asset_artifacts" DROP COLUMN IF EXISTS "owner_id";

    DROP TABLE IF EXISTS "projects_members";
    DROP TYPE IF EXISTS "public"."enum_projects_members_role";
    DROP TABLE IF EXISTS "users_roles";
    DROP TYPE IF EXISTS "public"."enum_users_roles";

    DROP TABLE IF EXISTS "_scenes_v_rels" CASCADE;
    DROP TABLE IF EXISTS "_scenes_v" CASCADE;
    ALTER TABLE "scenes" DROP COLUMN IF EXISTS "_status";
    DROP TYPE IF EXISTS "public"."enum__scenes_v_version_status";
  `);
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Local RBAC metadata cleanup is intentionally irreversible.');
}
