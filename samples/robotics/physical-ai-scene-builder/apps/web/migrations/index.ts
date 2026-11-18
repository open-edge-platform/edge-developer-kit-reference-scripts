// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import * as migration_20260805_000000_initial_schema from './20260805_000000_initial_schema';
import * as migration_20260806_014207_asset_library_foundation from './20260806_014207_asset_library_foundation';
import * as migration_20260806_030000_material_library from './20260806_030000_material_library';
import * as migration_20260806_031000_material_collection from './20260806_031000_material_collection';
import * as migration_20260806_032000_material_texture from './20260806_032000_material_texture';
import * as migration_20260806_033000_primitive_asset_definition from './20260806_033000_primitive_asset_definition';
import * as migration_20260806_034000_custom_shape_asset from './20260806_034000_custom_shape_asset';
import * as migration_20260806_040000_scene_persistence from './20260806_040000_scene_persistence';
import * as migration_20260807_000000_local_public_access from './20260807_000000_local_public_access';
import * as migration_20260807_010000_remove_local_rbac_metadata from './20260807_010000_remove_local_rbac_metadata';
import * as migration_20260817_000000_milestone_2_evaluation_profiles from './20260817_000000_milestone_2_evaluation_profiles';
import * as migration_20260817_030000_remove_evaluation_profiles from './20260817_030000_remove_evaluation_profiles';
import * as migration_20260818_000000_asset_calibration from './20260818_000000_asset_calibration';
import * as migration_20260821_000000_so101_sample_scene from './20260821_000000_so101_sample_scene';
import * as migration_20260907_000000_scene_templates from './20260907_000000_scene_templates';
import * as migration_20260907_010000_global_so101_template from './20260907_010000_global_so101_template';
import * as migration_20260926_010000_convex_hull_collision from './20260926_010000_convex_hull_collision';
import * as migration_20261007_000000_splat_assets from './20261007_000000_splat_assets';
import * as migration_20261102_000000_object_model_assets from './20261102_000000_object_model_assets';

export const migrations = [
  {
    up: migration_20260805_000000_initial_schema.up,
    down: migration_20260805_000000_initial_schema.down,
    name: '20260805_000000_initial_schema',
  },
  {
    up: migration_20260806_014207_asset_library_foundation.up,
    down: migration_20260806_014207_asset_library_foundation.down,
    name: '20260806_014207_asset_library_foundation',
  },
  {
    up: migration_20260806_030000_material_library.up,
    down: migration_20260806_030000_material_library.down,
    name: '20260806_030000_material_library',
  },
  {
    up: migration_20260806_031000_material_collection.up,
    down: migration_20260806_031000_material_collection.down,
    name: '20260806_031000_material_collection',
  },
  {
    up: migration_20260806_032000_material_texture.up,
    down: migration_20260806_032000_material_texture.down,
    name: '20260806_032000_material_texture',
  },
  {
    up: migration_20260806_033000_primitive_asset_definition.up,
    down: migration_20260806_033000_primitive_asset_definition.down,
    name: '20260806_033000_primitive_asset_definition',
  },
  {
    up: migration_20260806_034000_custom_shape_asset.up,
    down: migration_20260806_034000_custom_shape_asset.down,
    name: '20260806_034000_custom_shape_asset',
  },
  {
    up: migration_20260806_040000_scene_persistence.up,
    down: migration_20260806_040000_scene_persistence.down,
    name: '20260806_040000_scene_persistence',
  },
  {
    up: migration_20260807_000000_local_public_access.up,
    down: migration_20260807_000000_local_public_access.down,
    name: '20260807_000000_local_public_access',
  },
  {
    up: migration_20260807_010000_remove_local_rbac_metadata.up,
    down: migration_20260807_010000_remove_local_rbac_metadata.down,
    name: '20260807_010000_remove_local_rbac_metadata',
  },
  {
    up: migration_20260817_000000_milestone_2_evaluation_profiles.up,
    down: migration_20260817_000000_milestone_2_evaluation_profiles.down,
    name: '20260817_000000_milestone_2_evaluation_profiles',
  },
  {
    up: migration_20260817_030000_remove_evaluation_profiles.up,
    down: migration_20260817_030000_remove_evaluation_profiles.down,
    name: '20260817_030000_remove_evaluation_profiles',
  },
  {
    up: migration_20260818_000000_asset_calibration.up,
    down: migration_20260818_000000_asset_calibration.down,
    name: '20260818_000000_asset_calibration',
  },
  {
    up: migration_20260821_000000_so101_sample_scene.up,
    down: migration_20260821_000000_so101_sample_scene.down,
    name: '20260821_000000_so101_sample_scene',
  },
  {
    up: migration_20260907_000000_scene_templates.up,
    down: migration_20260907_000000_scene_templates.down,
    name: '20260907_000000_scene_templates',
  },
  {
    up: migration_20260907_010000_global_so101_template.up,
    down: migration_20260907_010000_global_so101_template.down,
    name: '20260907_010000_global_so101_template',
  },
  {
    up: migration_20260926_010000_convex_hull_collision.up,
    down: migration_20260926_010000_convex_hull_collision.down,
    name: '20260926_010000_convex_hull_collision',
  },
  {
    up: migration_20261007_000000_splat_assets.up,
    down: migration_20261007_000000_splat_assets.down,
    name: '20261007_000000_splat_assets',
  },
  {
    up: migration_20261102_000000_object_model_assets.up,
    down: migration_20261102_000000_object_model_assets.down,
    name: '20261102_000000_object_model_assets',
  },
];
