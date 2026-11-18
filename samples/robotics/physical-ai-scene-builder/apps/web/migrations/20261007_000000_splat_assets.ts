// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres';

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`ALTER TYPE "public"."enum_assets_kind" ADD VALUE IF NOT EXISTS 'splat';`);
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  // PostgreSQL cannot remove an enum value safely.
}
