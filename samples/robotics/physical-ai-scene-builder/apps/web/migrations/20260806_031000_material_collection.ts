// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres';

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "public"."enum_materials_visibility" AS ENUM('private', 'library');
    CREATE TABLE "materials" (
      "id" serial PRIMARY KEY NOT NULL,
      "name" varchar NOT NULL,
      "color" varchar DEFAULT '#9eb4c8' NOT NULL,
      "metallic" numeric DEFAULT 0 NOT NULL,
      "roughness" numeric DEFAULT 0.6 NOT NULL,
      "owner_id" integer,
      "visibility" "enum_materials_visibility" DEFAULT 'private' NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );
    ALTER TABLE "materials"
      ADD CONSTRAINT "materials_owner_id_users_id_fk"
      FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
    CREATE INDEX "materials_owner_idx" ON "materials" USING btree ("owner_id");
    CREATE INDEX "materials_updated_at_idx" ON "materials" USING btree ("updated_at");
    CREATE INDEX "materials_created_at_idx" ON "materials" USING btree ("created_at");
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "materials";
    DROP TYPE "public"."enum_materials_visibility";
  `);
}
