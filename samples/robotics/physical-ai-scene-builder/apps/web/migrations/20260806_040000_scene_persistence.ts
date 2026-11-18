// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres';

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "assets"
      ADD COLUMN "project_id" integer;

    CREATE TABLE "scenes_rels" (
      "id" serial PRIMARY KEY NOT NULL,
      "order" integer,
      "parent_id" integer NOT NULL,
      "path" varchar NOT NULL,
      "assets_id" integer
    );

    CREATE TABLE "_scenes_v_rels" (
      "id" serial PRIMARY KEY NOT NULL,
      "order" integer,
      "parent_id" integer NOT NULL,
      "path" varchar NOT NULL,
      "assets_id" integer
    );

    ALTER TABLE "assets"
      ADD CONSTRAINT "assets_project_id_projects_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
      ON DELETE set null ON UPDATE no action;
    ALTER TABLE "scenes_rels"
      ADD CONSTRAINT "scenes_rels_parent_fk"
      FOREIGN KEY ("parent_id") REFERENCES "public"."scenes"("id")
      ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "scenes_rels"
      ADD CONSTRAINT "scenes_rels_assets_fk"
      FOREIGN KEY ("assets_id") REFERENCES "public"."assets"("id")
      ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "_scenes_v_rels"
      ADD CONSTRAINT "_scenes_v_rels_parent_fk"
      FOREIGN KEY ("parent_id") REFERENCES "public"."_scenes_v"("id")
      ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "_scenes_v_rels"
      ADD CONSTRAINT "_scenes_v_rels_assets_fk"
      FOREIGN KEY ("assets_id") REFERENCES "public"."assets"("id")
      ON DELETE cascade ON UPDATE no action;

    CREATE INDEX "assets_project_idx" ON "assets" USING btree ("project_id");
    CREATE INDEX "scenes_rels_order_idx" ON "scenes_rels" USING btree ("order");
    CREATE INDEX "scenes_rels_parent_idx" ON "scenes_rels" USING btree ("parent_id");
    CREATE INDEX "scenes_rels_path_idx" ON "scenes_rels" USING btree ("path");
    CREATE INDEX "scenes_rels_assets_id_idx" ON "scenes_rels" USING btree ("assets_id");
    CREATE INDEX "_scenes_v_rels_order_idx" ON "_scenes_v_rels" USING btree ("order");
    CREATE INDEX "_scenes_v_rels_parent_idx" ON "_scenes_v_rels" USING btree ("parent_id");
    CREATE INDEX "_scenes_v_rels_path_idx" ON "_scenes_v_rels" USING btree ("path");
    CREATE INDEX "_scenes_v_rels_assets_id_idx" ON "_scenes_v_rels" USING btree ("assets_id");
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "scenes_rels" DROP CONSTRAINT "scenes_rels_assets_fk";
    ALTER TABLE "scenes_rels" DROP CONSTRAINT "scenes_rels_parent_fk";
    ALTER TABLE "_scenes_v_rels" DROP CONSTRAINT "_scenes_v_rels_assets_fk";
    ALTER TABLE "_scenes_v_rels" DROP CONSTRAINT "_scenes_v_rels_parent_fk";
    ALTER TABLE "assets" DROP CONSTRAINT "assets_project_id_projects_id_fk";

    DROP TABLE "scenes_rels";
    DROP TABLE "_scenes_v_rels";
    ALTER TABLE "assets" DROP COLUMN "project_id";
  `);
}
