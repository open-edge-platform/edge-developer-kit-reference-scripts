// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres';

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_users_roles" AS ENUM('admin', 'user');
  CREATE TYPE "public"."enum_projects_members_role" AS ENUM('editor', 'viewer');
  CREATE TYPE "public"."enum_scenes_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__scenes_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_assets_category" AS ENUM('mesh', 'texture', 'material', 'thumbnail');
  CREATE TABLE "users_roles" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_users_roles",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "users_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "users" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"email" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  CREATE TABLE "projects_members" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"user_id" integer NOT NULL,
  	"role" "enum_projects_members_role" DEFAULT 'viewer' NOT NULL
  );
  
  CREATE TABLE "projects" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"slug" varchar,
  	"description" varchar,
  	"owner_id" integer NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "scenes" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"project_id" integer,
  	"owner_id" integer,
  	"graph" jsonb,
  	"mjcf" varchar,
  	"thumbnail_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_scenes_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "_scenes_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_name" varchar,
  	"version_project_id" integer,
  	"version_owner_id" integer,
  	"version_graph" jsonb,
  	"version_mjcf" varchar,
  	"version_thumbnail_id" integer,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__scenes_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "assets" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"category" "enum_assets_category" DEFAULT 'mesh',
  	"metadata" jsonb,
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
  	"focal_y" numeric,
  	"sizes_thumbnail_url" varchar,
  	"sizes_thumbnail_width" numeric,
  	"sizes_thumbnail_height" numeric,
  	"sizes_thumbnail_mime_type" varchar,
  	"sizes_thumbnail_filesize" numeric,
  	"sizes_thumbnail_filename" varchar
  );
  
  CREATE TABLE "assets_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "robots" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"slug" varchar,
  	"description" varchar,
  	"manufacturer" varchar,
  	"thumbnail_id" integer,
  	"mjcf" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "robots_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "robots_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"assets_id" integer
  );
  
  CREATE TABLE "payload_kv" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar NOT NULL,
  	"data" jsonb NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"global_slug" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer,
  	"projects_id" integer,
  	"scenes_id" integer,
  	"assets_id" integer,
  	"robots_id" integer
  );
  
  CREATE TABLE "payload_preferences" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar,
  	"value" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_preferences_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );
  
  CREATE TABLE "payload_migrations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"batch" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "users_roles" ADD CONSTRAINT "users_roles_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "users_sessions" ADD CONSTRAINT "users_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "projects_members" ADD CONSTRAINT "projects_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "projects_members" ADD CONSTRAINT "projects_members_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "scenes" ADD CONSTRAINT "scenes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "scenes" ADD CONSTRAINT "scenes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "scenes" ADD CONSTRAINT "scenes_thumbnail_id_assets_id_fk" FOREIGN KEY ("thumbnail_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_scenes_v" ADD CONSTRAINT "_scenes_v_parent_id_scenes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."scenes"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_scenes_v" ADD CONSTRAINT "_scenes_v_version_project_id_projects_id_fk" FOREIGN KEY ("version_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_scenes_v" ADD CONSTRAINT "_scenes_v_version_owner_id_users_id_fk" FOREIGN KEY ("version_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_scenes_v" ADD CONSTRAINT "_scenes_v_version_thumbnail_id_assets_id_fk" FOREIGN KEY ("version_thumbnail_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "assets_texts" ADD CONSTRAINT "assets_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "robots" ADD CONSTRAINT "robots_thumbnail_id_assets_id_fk" FOREIGN KEY ("thumbnail_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "robots_texts" ADD CONSTRAINT "robots_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."robots"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "robots_rels" ADD CONSTRAINT "robots_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."robots"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "robots_rels" ADD CONSTRAINT "robots_rels_assets_fk" FOREIGN KEY ("assets_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_projects_fk" FOREIGN KEY ("projects_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_scenes_fk" FOREIGN KEY ("scenes_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_assets_fk" FOREIGN KEY ("assets_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_robots_fk" FOREIGN KEY ("robots_id") REFERENCES "public"."robots"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "users_roles_order_idx" ON "users_roles" USING btree ("order");
  CREATE INDEX "users_roles_parent_idx" ON "users_roles" USING btree ("parent_id");
  CREATE INDEX "users_sessions_order_idx" ON "users_sessions" USING btree ("_order");
  CREATE INDEX "users_sessions_parent_id_idx" ON "users_sessions" USING btree ("_parent_id");
  CREATE INDEX "users_updated_at_idx" ON "users" USING btree ("updated_at");
  CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");
  CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");
  CREATE INDEX "projects_members_order_idx" ON "projects_members" USING btree ("_order");
  CREATE INDEX "projects_members_parent_id_idx" ON "projects_members" USING btree ("_parent_id");
  CREATE INDEX "projects_members_user_idx" ON "projects_members" USING btree ("user_id");
  CREATE UNIQUE INDEX "projects_slug_idx" ON "projects" USING btree ("slug");
  CREATE INDEX "projects_owner_idx" ON "projects" USING btree ("owner_id");
  CREATE INDEX "projects_updated_at_idx" ON "projects" USING btree ("updated_at");
  CREATE INDEX "projects_created_at_idx" ON "projects" USING btree ("created_at");
  CREATE INDEX "scenes_project_idx" ON "scenes" USING btree ("project_id");
  CREATE INDEX "scenes_owner_idx" ON "scenes" USING btree ("owner_id");
  CREATE INDEX "scenes_thumbnail_idx" ON "scenes" USING btree ("thumbnail_id");
  CREATE INDEX "scenes_updated_at_idx" ON "scenes" USING btree ("updated_at");
  CREATE INDEX "scenes_created_at_idx" ON "scenes" USING btree ("created_at");
  CREATE INDEX "scenes__status_idx" ON "scenes" USING btree ("_status");
  CREATE INDEX "_scenes_v_parent_idx" ON "_scenes_v" USING btree ("parent_id");
  CREATE INDEX "_scenes_v_version_version_project_idx" ON "_scenes_v" USING btree ("version_project_id");
  CREATE INDEX "_scenes_v_version_version_owner_idx" ON "_scenes_v" USING btree ("version_owner_id");
  CREATE INDEX "_scenes_v_version_version_thumbnail_idx" ON "_scenes_v" USING btree ("version_thumbnail_id");
  CREATE INDEX "_scenes_v_version_version_updated_at_idx" ON "_scenes_v" USING btree ("version_updated_at");
  CREATE INDEX "_scenes_v_version_version_created_at_idx" ON "_scenes_v" USING btree ("version_created_at");
  CREATE INDEX "_scenes_v_version_version__status_idx" ON "_scenes_v" USING btree ("version__status");
  CREATE INDEX "_scenes_v_created_at_idx" ON "_scenes_v" USING btree ("created_at");
  CREATE INDEX "_scenes_v_updated_at_idx" ON "_scenes_v" USING btree ("updated_at");
  CREATE INDEX "_scenes_v_latest_idx" ON "_scenes_v" USING btree ("latest");
  CREATE INDEX "assets_updated_at_idx" ON "assets" USING btree ("updated_at");
  CREATE INDEX "assets_created_at_idx" ON "assets" USING btree ("created_at");
  CREATE UNIQUE INDEX "assets_filename_idx" ON "assets" USING btree ("filename");
  CREATE INDEX "assets_sizes_thumbnail_sizes_thumbnail_filename_idx" ON "assets" USING btree ("sizes_thumbnail_filename");
  CREATE INDEX "assets_texts_order_parent" ON "assets_texts" USING btree ("order","parent_id");
  CREATE UNIQUE INDEX "robots_slug_idx" ON "robots" USING btree ("slug");
  CREATE INDEX "robots_thumbnail_idx" ON "robots" USING btree ("thumbnail_id");
  CREATE INDEX "robots_updated_at_idx" ON "robots" USING btree ("updated_at");
  CREATE INDEX "robots_created_at_idx" ON "robots" USING btree ("created_at");
  CREATE INDEX "robots_texts_order_parent" ON "robots_texts" USING btree ("order","parent_id");
  CREATE INDEX "robots_rels_order_idx" ON "robots_rels" USING btree ("order");
  CREATE INDEX "robots_rels_parent_idx" ON "robots_rels" USING btree ("parent_id");
  CREATE INDEX "robots_rels_path_idx" ON "robots_rels" USING btree ("path");
  CREATE INDEX "robots_rels_assets_id_idx" ON "robots_rels" USING btree ("assets_id");
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "payload_kv" USING btree ("key");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_users_id_idx" ON "payload_locked_documents_rels" USING btree ("users_id");
  CREATE INDEX "payload_locked_documents_rels_projects_id_idx" ON "payload_locked_documents_rels" USING btree ("projects_id");
  CREATE INDEX "payload_locked_documents_rels_scenes_id_idx" ON "payload_locked_documents_rels" USING btree ("scenes_id");
  CREATE INDEX "payload_locked_documents_rels_assets_id_idx" ON "payload_locked_documents_rels" USING btree ("assets_id");
  CREATE INDEX "payload_locked_documents_rels_robots_id_idx" ON "payload_locked_documents_rels" USING btree ("robots_id");
  CREATE INDEX "payload_preferences_key_idx" ON "payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_users_id_idx" ON "payload_preferences_rels" USING btree ("users_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "payload_migrations" USING btree ("created_at");`);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "users_roles" CASCADE;
  DROP TABLE "users_sessions" CASCADE;
  DROP TABLE "users" CASCADE;
  DROP TABLE "projects_members" CASCADE;
  DROP TABLE "projects" CASCADE;
  DROP TABLE "scenes" CASCADE;
  DROP TABLE "_scenes_v" CASCADE;
  DROP TABLE "assets" CASCADE;
  DROP TABLE "assets_texts" CASCADE;
  DROP TABLE "robots" CASCADE;
  DROP TABLE "robots_texts" CASCADE;
  DROP TABLE "robots_rels" CASCADE;
  DROP TABLE "payload_kv" CASCADE;
  DROP TABLE "payload_locked_documents" CASCADE;
  DROP TABLE "payload_locked_documents_rels" CASCADE;
  DROP TABLE "payload_preferences" CASCADE;
  DROP TABLE "payload_preferences_rels" CASCADE;
  DROP TABLE "payload_migrations" CASCADE;
  DROP TYPE "public"."enum_users_roles";
  DROP TYPE "public"."enum_projects_members_role";
  DROP TYPE "public"."enum_scenes_status";
  DROP TYPE "public"."enum__scenes_v_version_status";
  DROP TYPE "public"."enum_assets_category";`);
}
