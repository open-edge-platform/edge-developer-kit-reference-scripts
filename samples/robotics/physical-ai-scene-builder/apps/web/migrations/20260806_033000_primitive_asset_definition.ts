// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres';

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "public"."enum_assets_primitive_type" AS ENUM('box', 'sphere', 'capsule', 'cylinder', 'ellipsoid');

    ALTER TABLE "assets"
      ADD COLUMN "primitive_type" "enum_assets_primitive_type",
      ADD COLUMN "primitive_mass" numeric;

    CREATE TABLE "assets_primitive_size" (
      "_order" integer NOT NULL,
      "_parent_id" integer NOT NULL,
      "id" varchar PRIMARY KEY NOT NULL,
      "value" numeric NOT NULL
    );

    CREATE TABLE "assets_primitive_rgba" (
      "_order" integer NOT NULL,
      "_parent_id" integer NOT NULL,
      "id" varchar PRIMARY KEY NOT NULL,
      "value" numeric NOT NULL
    );

    CREATE TABLE "assets_primitive_friction" (
      "_order" integer NOT NULL,
      "_parent_id" integer NOT NULL,
      "id" varchar PRIMARY KEY NOT NULL,
      "value" numeric NOT NULL
    );

    ALTER TABLE "assets_primitive_size"
      ADD CONSTRAINT "assets_primitive_size_parent_id_fk"
      FOREIGN KEY ("_parent_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "assets_primitive_rgba"
      ADD CONSTRAINT "assets_primitive_rgba_parent_id_fk"
      FOREIGN KEY ("_parent_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "assets_primitive_friction"
      ADD CONSTRAINT "assets_primitive_friction_parent_id_fk"
      FOREIGN KEY ("_parent_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;

    CREATE INDEX "assets_primitive_size_order_idx" ON "assets_primitive_size" USING btree ("_order");
    CREATE INDEX "assets_primitive_size_parent_id_idx" ON "assets_primitive_size" USING btree ("_parent_id");
    CREATE INDEX "assets_primitive_rgba_order_idx" ON "assets_primitive_rgba" USING btree ("_order");
    CREATE INDEX "assets_primitive_rgba_parent_id_idx" ON "assets_primitive_rgba" USING btree ("_parent_id");
    CREATE INDEX "assets_primitive_friction_order_idx" ON "assets_primitive_friction" USING btree ("_order");
    CREATE INDEX "assets_primitive_friction_parent_id_idx" ON "assets_primitive_friction" USING btree ("_parent_id");
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "assets_primitive_size"
      DROP CONSTRAINT "assets_primitive_size_parent_id_fk";
    ALTER TABLE "assets_primitive_rgba"
      DROP CONSTRAINT "assets_primitive_rgba_parent_id_fk";
    ALTER TABLE "assets_primitive_friction"
      DROP CONSTRAINT "assets_primitive_friction_parent_id_fk";

    DROP TABLE "assets_primitive_size";
    DROP TABLE "assets_primitive_rgba";
    DROP TABLE "assets_primitive_friction";
    ALTER TABLE "assets"
      DROP COLUMN "primitive_type",
      DROP COLUMN "primitive_mass";
    DROP TYPE "public"."enum_assets_primitive_type";
  `);
}
