// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres';

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "public"."enum_assets_kind" AS ENUM('mesh', 'texture', 'material');
    CREATE TYPE "public"."enum_assets_visibility" AS ENUM('private', 'library');
    CREATE TYPE "public"."enum_assets_processing_status" AS ENUM('uploaded', 'queued', 'processing', 'ready', 'failed');
    CREATE TYPE "public"."enum_assets_metadata_source_format" AS ENUM('glb', 'obj', 'stl');
    CREATE TYPE "public"."enum_assets_metadata_unit" AS ENUM('m', 'cm', 'mm');
    CREATE TYPE "public"."enum_assets_metadata_up_axis" AS ENUM('y', 'z');
    CREATE TYPE "public"."enum_asset_artifacts_visibility" AS ENUM('private', 'library');
    CREATE TYPE "public"."enum_asset_artifacts_artifact_type" AS ENUM('canonicalMesh', 'collisionMesh', 'thumbnail');

    ALTER TABLE "assets" ADD COLUMN "kind" "enum_assets_kind" DEFAULT 'mesh' NOT NULL;
    UPDATE "assets"
      SET "kind" = CASE "category"::text
        WHEN 'texture' THEN 'texture'::"enum_assets_kind"
        WHEN 'material' THEN 'material'::"enum_assets_kind"
        ELSE 'mesh'::"enum_assets_kind"
      END;

    ALTER TYPE "public"."enum_assets_category" RENAME TO "enum_assets_category_legacy";
    CREATE TYPE "public"."enum_assets_category" AS ENUM('general', 'furniture', 'industrial', 'terrain', 'props');
    ALTER TABLE "assets" ALTER COLUMN "category" DROP DEFAULT;
    ALTER TABLE "assets"
      ALTER COLUMN "category" TYPE "enum_assets_category"
      USING CASE
        WHEN "category" IS NULL THEN NULL
        ELSE 'general'::"enum_assets_category"
      END;
    DROP TYPE "public"."enum_assets_category_legacy";

    ALTER TABLE "assets"
      ADD COLUMN "owner_id" integer,
      ADD COLUMN "visibility" "enum_assets_visibility" DEFAULT 'private' NOT NULL,
      ADD COLUMN "processing_status" "enum_assets_processing_status" DEFAULT 'uploaded' NOT NULL,
      ADD COLUMN "processing_progress" numeric,
      ADD COLUMN "processing_error" varchar,
      ADD COLUMN "metadata_source_format" "enum_assets_metadata_source_format",
      ADD COLUMN "metadata_unit" "enum_assets_metadata_unit",
      ADD COLUMN "metadata_up_axis" "enum_assets_metadata_up_axis",
      ADD COLUMN "metadata_vertex_count" numeric,
      ADD COLUMN "metadata_triangle_count" numeric,
      ADD COLUMN "canonical_mesh_id" integer,
      ADD COLUMN "collision_mesh_id" integer,
      ADD COLUMN "thumbnail_id" integer;

    CREATE TABLE "assets_metadata_dimensions_meters" (
      "_order" integer NOT NULL,
      "_parent_id" integer NOT NULL,
      "id" varchar PRIMARY KEY NOT NULL,
      "value" numeric NOT NULL
    );

    CREATE TABLE "asset_artifacts" (
      "id" serial PRIMARY KEY NOT NULL,
      "owner_id" integer,
      "visibility" "enum_asset_artifacts_visibility" DEFAULT 'private' NOT NULL,
      "artifact_type" "enum_asset_artifacts_artifact_type" NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "url" varchar,
      "thumbnail_u_r_l" varchar,
      "filename" varchar,
      "mime_type" varchar,
      "filesize" numeric,
      "width" numeric,
      "height" numeric,
      "focal_x" numeric,
      "focal_y" numeric
    );

    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "asset_artifacts_id" integer;

    ALTER TABLE "assets_metadata_dimensions_meters"
      ADD CONSTRAINT "assets_metadata_dimensions_meters_parent_id_fk"
      FOREIGN KEY ("_parent_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "assets"
      ADD CONSTRAINT "assets_owner_id_users_id_fk"
      FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "assets"
      ADD CONSTRAINT "assets_canonical_mesh_id_asset_artifacts_id_fk"
      FOREIGN KEY ("canonical_mesh_id") REFERENCES "public"."asset_artifacts"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "assets"
      ADD CONSTRAINT "assets_collision_mesh_id_asset_artifacts_id_fk"
      FOREIGN KEY ("collision_mesh_id") REFERENCES "public"."asset_artifacts"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "assets"
      ADD CONSTRAINT "assets_thumbnail_id_asset_artifacts_id_fk"
      FOREIGN KEY ("thumbnail_id") REFERENCES "public"."asset_artifacts"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "asset_artifacts"
      ADD CONSTRAINT "asset_artifacts_owner_id_users_id_fk"
      FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "payload_locked_documents_rels"
      ADD CONSTRAINT "payload_locked_documents_rels_asset_artifacts_fk"
      FOREIGN KEY ("asset_artifacts_id") REFERENCES "public"."asset_artifacts"("id") ON DELETE cascade ON UPDATE no action;

    CREATE INDEX "assets_metadata_dimensions_meters_order_idx" ON "assets_metadata_dimensions_meters" USING btree ("_order");
    CREATE INDEX "assets_metadata_dimensions_meters_parent_id_idx" ON "assets_metadata_dimensions_meters" USING btree ("_parent_id");
    CREATE INDEX "assets_owner_idx" ON "assets" USING btree ("owner_id");
    CREATE INDEX "assets_processing_status_idx" ON "assets" USING btree ("processing_status");
    CREATE INDEX "assets_canonical_mesh_idx" ON "assets" USING btree ("canonical_mesh_id");
    CREATE INDEX "assets_collision_mesh_idx" ON "assets" USING btree ("collision_mesh_id");
    CREATE INDEX "assets_thumbnail_idx" ON "assets" USING btree ("thumbnail_id");
    CREATE INDEX "asset_artifacts_owner_idx" ON "asset_artifacts" USING btree ("owner_id");
    CREATE INDEX "asset_artifacts_updated_at_idx" ON "asset_artifacts" USING btree ("updated_at");
    CREATE INDEX "asset_artifacts_created_at_idx" ON "asset_artifacts" USING btree ("created_at");
    CREATE UNIQUE INDEX "asset_artifacts_filename_idx" ON "asset_artifacts" USING btree ("filename");
    CREATE INDEX "payload_locked_documents_rels_asset_artifacts_id_idx" ON "payload_locked_documents_rels" USING btree ("asset_artifacts_id");
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_asset_artifacts_fk";
    ALTER TABLE "assets" DROP CONSTRAINT "assets_owner_id_users_id_fk";
    ALTER TABLE "assets" DROP CONSTRAINT "assets_canonical_mesh_id_asset_artifacts_id_fk";
    ALTER TABLE "assets" DROP CONSTRAINT "assets_collision_mesh_id_asset_artifacts_id_fk";
    ALTER TABLE "assets" DROP CONSTRAINT "assets_thumbnail_id_asset_artifacts_id_fk";
    ALTER TABLE "asset_artifacts" DROP CONSTRAINT "asset_artifacts_owner_id_users_id_fk";
    ALTER TABLE "assets_metadata_dimensions_meters" DROP CONSTRAINT "assets_metadata_dimensions_meters_parent_id_fk";

    DROP TABLE "assets_metadata_dimensions_meters";
    DROP TABLE "asset_artifacts";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "asset_artifacts_id";
    ALTER TABLE "assets"
      DROP COLUMN "kind",
      DROP COLUMN "owner_id",
      DROP COLUMN "visibility",
      DROP COLUMN "processing_status",
      DROP COLUMN "processing_progress",
      DROP COLUMN "processing_error",
      DROP COLUMN "metadata_source_format",
      DROP COLUMN "metadata_unit",
      DROP COLUMN "metadata_up_axis",
      DROP COLUMN "metadata_vertex_count",
      DROP COLUMN "metadata_triangle_count",
      DROP COLUMN "canonical_mesh_id",
      DROP COLUMN "collision_mesh_id",
      DROP COLUMN "thumbnail_id";

    ALTER TABLE "assets" ALTER COLUMN "category" TYPE text USING "category"::text;
    DROP TYPE "public"."enum_assets_category";
    CREATE TYPE "public"."enum_assets_category" AS ENUM('mesh', 'texture', 'material', 'thumbnail');
    ALTER TABLE "assets"
      ALTER COLUMN "category" TYPE "enum_assets_category"
      USING CASE
        WHEN "category" IS NULL THEN NULL
        ELSE 'mesh'::"enum_assets_category"
      END;
    ALTER TABLE "assets" ALTER COLUMN "category" SET DEFAULT 'mesh';

    DROP TYPE "public"."enum_assets_kind";
    DROP TYPE "public"."enum_assets_visibility";
    DROP TYPE "public"."enum_assets_processing_status";
    DROP TYPE "public"."enum_assets_metadata_source_format";
    DROP TYPE "public"."enum_assets_metadata_unit";
    DROP TYPE "public"."enum_assets_metadata_up_axis";
    DROP TYPE "public"."enum_asset_artifacts_visibility";
    DROP TYPE "public"."enum_asset_artifacts_artifact_type";
  `);
}
