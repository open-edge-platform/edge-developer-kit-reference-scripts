// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';

import { IMAGE_TO_3D_PIPELINE_TYPES } from '@/lib/scenes/imageTo3dApi';

const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const name = z.string().trim().min(1).max(100);
const target = z.object({
  kind: z.enum(['body', 'geom', 'camera', 'light', 'site']),
  name,
});

export const tablePlacementSchema = z.object({
  name: name.default('table'),
  dimensions: z
    .tuple([
      z.number().positive().finite(),
      z.number().positive().finite(),
      z.number().positive().finite(),
    ])
    .default([1.2, 0.8, 0.75])
    .describe('Full width (X), depth (Y), and floor-to-tabletop height (Z), in meters.'),
  position: vector
    .default([0, 0, 0])
    .describe('Floor-level center of the table, NOT tabletop center.'),
  rotation: vector.default([0, 0, 0]).describe('Euler angles in the scene compiler angle unit.'),
  topThickness: z.number().positive().finite().default(0.04),
  legWidth: z.number().positive().finite().default(0.05),
});

export const sceneOperationSchema = z.discriminatedUnion('type', [
  tablePlacementSchema.extend({ type: z.literal('add_table') }),
  z.object({
    type: z.literal('add_primitive'),
    name,
    shape: z.enum(['box', 'sphere', 'cylinder', 'capsule', 'ellipsoid']),
    size: vector.describe(
      'MuJoCo sizes in meters: box half-extents; sphere radius; cylinder/capsule radius and half-length.',
    ),
    position: vector,
    rotation: vector.default([0, 0, 0]).describe('Euler angles in the scene compiler angle unit.'),
    rgba: z
      .tuple([
        z.number().min(0).max(1),
        z.number().min(0).max(1),
        z.number().min(0).max(1),
        z.number().min(0).max(1),
      ])
      .default([0.7, 0.3, 0.2, 1]),
    mass: z.number().positive().default(0.1),
    fixed: z.boolean().default(false).describe('Fixed furniture/supports have no free joint.'),
    friction: vector.default([1, 0.005, 0.0001]),
  }),
  z.object({
    type: z.literal('add_container'),
    name: name.default('container'),
    inner: z
      .tuple([z.number().positive().max(2), z.number().positive().max(2)])
      .describe('Inside width (X) and depth (Y), meters; the walls are outside this.'),
    wallHeight: z.number().positive().max(1).default(0.035).describe('Height of the walls, m.'),
    wallThickness: z.number().positive().max(0.1).default(0.005),
    position: vector.describe(
      'Centre of the underside in world meters; then place_object sets it down on a table.',
    ),
    rotation: vector.default([0, 0, 0]).describe('Euler angles in the scene compiler angle unit.'),
    rgba: z
      .tuple([
        z.number().min(0).max(1),
        z.number().min(0).max(1),
        z.number().min(0).max(1),
        z.number().min(0).max(1),
      ])
      .default([0.2, 0.4, 0.8, 1]),
    mass: z.number().positive().default(0.1).describe('Total mass, kg.'),
    fixed: z
      .boolean()
      .default(true)
      .describe('Fixed containers stay put when bumped; set false for a loose tray.'),
  }),
  z.object({
    type: z.literal('add_camera'),
    name,
    position: vector,
    target: vector,
    fovy: z.number().min(1).max(179).default(45),
  }),
  z.object({
    type: z.literal('aim_camera'),
    camera: name.describe('Existing world camera (not body-mounted) to move and re-aim.'),
    position: vector.describe('New world camera position, in meters.'),
    target: vector.describe('World point the camera looks at, in meters.'),
    fovy: z.number().min(1).max(179).optional().describe('New vertical field of view, degrees.'),
  }),
  z.object({
    type: z.literal('add_mounted_camera'),
    name,
    parentBody: name.describe(
      'Unique existing body name from get_scene; not world or splat backdrop.',
    ),
    position: vector.describe('Camera position in the parent body local frame, in meters.'),
    quaternion: z
      .tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
      .refine((value) => Math.hypot(...value) >= Number.EPSILON, 'Quaternion must be nonzero.')
      .default([1, 0, 0, 0])
      .describe(
        'Local camera orientation as MuJoCo [w, x, y, z]; camera looks along local -Z, up is +Y.',
      ),
    fovy: z.number().min(1).max(179).default(45),
  }),
  z.object({
    type: z.literal('add_light'),
    name,
    lightType: z.enum(['directional', 'point', 'spot']).default('directional'),
    position: vector,
    direction: vector,
  }),
  z.object({
    type: z.literal('set_attribute'),
    target,
    attribute: z.enum([
      'pos',
      'quat',
      'euler',
      'size',
      'rgba',
      'mass',
      'friction',
      'fovy',
      'resolution',
      'diffuse',
      'specular',
      'dir',
    ]),
    value: z.union([z.number().finite(), z.array(z.number().finite()).min(1).max(6)]),
  }),
  z.object({ type: z.literal('delete_node'), target }),
  z.object({ type: z.literal('duplicate_node'), target }),
]);

export const editInputSchema = z.object({
  requestId: z
    .string()
    .uuid()
    .describe(
      'Unique operation ID. Reuse only to retrieve the same result, never for a different operation.',
    ),
  expectedRevision: z
    .string()
    .min(1)
    .describe('Revision from get_scene; stale edits are rejected.'),
  operations: z.array(sceneOperationSchema).min(1).max(50),
});

export const saveInputSchema = z.object({
  requestId: z.string().uuid(),
  expectedRevision: z.string().min(1),
});

export const robotInputSchema = saveInputSchema.extend({
  robotId: z.number().int().positive(),
});

export const tableInputSchema = tablePlacementSchema.extend(saveInputSchema.shape);

const planar = z.tuple([z.number().finite(), z.number().finite()]);

export const placeObjectInputSchema = saveInputSchema.extend({
  object: name.describe('Top-level body to move, from get_scene.'),
  at: planar.optional().describe('World X, Y in meters; the object is set down on what is below.'),
  on: name
    .optional()
    .describe('Body (or world geom such as a scan table) to set the object on, at its centre.'),
  offset: planar.default([0, 0]).describe('With on: X, Y offset from the surface centre, meters.'),
  beside: z
    .object({
      object: name.describe('Body to place next to.'),
      direction: planar.describe('World X, Y direction from that body, for example [0, 1].'),
      gap: z.number().min(0).max(1).default(0.02).describe('Clearance between them, meters.'),
    })
    .optional(),
  yaw: z
    .number()
    .min(-360)
    .max(360)
    .optional()
    .describe('Upright orientation about world Z, degrees. Omit to keep the current orientation.'),
});

export const objectPhysicsInputSchema = saveInputSchema.extend({
  object: name.describe('Top-level body, from get_scene.'),
  largestDimension: z
    .number()
    .positive()
    .max(5)
    .optional()
    .describe('Real-world size: scale the object so its largest side is this many meters.'),
  scale: z.number().positive().max(100).optional().describe('Or a uniform scale factor.'),
  mass: z.number().positive().max(1000).optional().describe('Total mass in kilograms.'),
  friction: z
    .union([z.number().min(0).max(10), z.array(z.number().min(0).max(10)).min(1).max(3)])
    .optional()
    .describe('Sliding friction, or [sliding, torsional, rolling].'),
});

export const detectTableInputSchema = z.object({
  minHeight: z.number().min(0.05).max(2).default(0.3).describe('Lowest top above the floor, m.'),
  maxHeight: z.number().min(0.1).max(3).default(1.3).describe('Highest top above the floor, m.'),
  workspaceRadius: z
    .number()
    .min(0)
    .max(5)
    .default(0.6)
    .describe('With a robot, fit only surface this close to its base (m); 0 fits whole surfaces.'),
});

export const scanTableInputSchema = saveInputSchema.extend({
  center: planar.describe('World X, Y of the table top centre (from detect_table).'),
  size: z
    .tuple([z.number().positive().max(10), z.number().positive().max(10)])
    .describe('Full width and depth, meters.'),
  top: z.number().finite().describe('World height of the table top, meters.'),
  yaw: z.number().min(-360).max(360).default(0).describe('Rotation about world Z, degrees.'),
});

export const assetListInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  search: z.string().max(100).default(''),
  category: z
    .enum(['all', 'general', 'furniture', 'industrial', 'terrain', 'props'])
    .default('all'),
});

export const assetInputSchema = saveInputSchema.extend({
  assetId: z.number().int().positive().describe('Object id from list_assets.'),
  position: vector
    .optional()
    .describe('World position of the object origin in meters. Defaults to [0, 0, 0.5].'),
});

/** Largest image `render_camera` returns, in pixels per side. */
export const RENDER_CAMERA_MAX_SIZE = 1280;

export const renderCameraInputSchema = z.object({
  camera: name
    .optional()
    .describe(
      'Scene camera name from get_scene. Renders exactly what that camera records, at its recorded resolution.',
    ),
  view: z
    .object({
      position: vector.describe('Eye position in world meters (MuJoCo Z-up).'),
      target: vector.describe('World point the view looks at.'),
      fovy: z.number().min(1).max(179).default(45),
    })
    .optional()
    .describe('A free view instead of a scene camera. Give exactly one of camera or view.'),
  width: z
    .number()
    .int()
    .min(16)
    .max(RENDER_CAMERA_MAX_SIZE)
    .optional()
    .describe('Image width in pixels; keeps the camera aspect when height is omitted.'),
  height: z.number().int().min(16).max(RENDER_CAMERA_MAX_SIZE).optional(),
  hideSplat: z
    .boolean()
    .default(false)
    .describe('Leave out the scanned room backdrop, to see only the simulated objects.'),
});

export const fitCameraInputSchema = z.object({
  points: z
    .array(
      z.object({
        world: vector.describe('World point in meters, for example a table-top corner.'),
        pixel: z
          .tuple([z.number().finite(), z.number().finite()])
          .describe('Where it appears in the photo: pixels from the top-left, +x right, +y down.'),
      }),
    )
    .min(4)
    .max(32)
    .describe('At least 4 points that span an area, such as the 4 corners of the table top.'),
  width: z.number().int().positive().max(20000).describe('Photo width in pixels.'),
  height: z.number().int().positive().max(20000).describe('Photo height in pixels.'),
  fovy: z
    .number()
    .min(1)
    .max(179)
    .optional()
    .describe('Known vertical field of view in degrees; omit to estimate it.'),
});

export const checkSceneInputSchema = z.object({
  settleSeconds: z
    .number()
    .min(0.1)
    .max(3)
    .default(1)
    .describe('Simulated seconds to watch objects settle under gravity (the scene is restored).'),
});

export const mcpToolNameSchema = z.enum([
  'get_scene',
  'render_camera',
  'fit_camera',
  'check_scene',
  'apply_scene_operations',
  'place_object',
  'set_object_physics',
  'save_scene',
  'list_robots',
  'add_table',
  'detect_table',
  'add_scan_table',
  'add_robot',
  'list_assets',
  'add_asset',
  'list_images',
  'start_image_to_3d',
  'get_image_to_3d_job',
]);
export type McpToolName = z.infer<typeof mcpToolNameSchema>;
export const MCP_TOOL_NAMES = mcpToolNameSchema.options;
/** Agents need get_scene's revision before any write, so it cannot be hidden. */
export const REQUIRED_MCP_TOOLS: readonly McpToolName[] = ['get_scene'];
/** Generation occupies the GPU for minutes, so users opt in to exposing it. */
export const DEFAULT_EXPOSED_TOOLS = MCP_TOOL_NAMES.filter((name) => name !== 'start_image_to_3d');
export const MCP_TOOL_SUMMARIES: Record<McpToolName, string> = {
  get_scene: 'Read the scene, node names, live poses, and revision.',
  render_camera: 'See an image from a scene camera or a free view, as recordings capture it.',
  fit_camera: 'Estimate a camera pose and lens from photo pixels of known points.',
  check_scene: 'Find overlaps, falling objects, unreachable or unseen objects, and camera gaps.',
  apply_scene_operations: 'Add primitives, cameras, and lights; edit, delete, or duplicate nodes.',
  place_object: 'Set an object down at a point, on a surface, or beside another object.',
  set_object_physics: 'Give an object its real-world size, mass, and friction.',
  save_scene: 'Save the scene to the project.',
  list_robots: 'Browse the robot catalog.',
  add_table: 'Add a fixed four-legged table.',
  detect_table: 'Find table tops in a scanned room and propose collision tables.',
  add_scan_table: 'Add a hidden collision table over a scanned table top.',
  add_robot: 'Add a catalog robot.',
  list_assets: 'Browse library objects, including image-to-3D objects.',
  add_asset: 'Add a library object to the scene.',
  list_images: 'List images shared with the agent for image-to-3D.',
  start_image_to_3d: 'Generate a library object from a shared image on the GPU.',
  get_image_to_3d_job: 'Check image-to-3D progress and the resulting object.',
};
export const exposedToolsSchema = z.array(mcpToolNameSchema).max(MCP_TOOL_NAMES.length);

export const imageJobStartSchema = z.object({
  requestId: z
    .string()
    .uuid()
    .describe('Unique operation ID. Reuse only to retrieve the same job, never for a new one.'),
  imageId: z.string().uuid().describe('Image id from list_images.'),
  pipelineType: z
    .enum(IMAGE_TO_3D_PIPELINE_TYPES)
    .default('512')
    .describe('Quality: 512 is fastest; 1024, 1024_cascade, and 1536_cascade take longer.'),
});

export const imageJobInputSchema = z.object({
  jobId: z.string().uuid().describe('Job id from start_image_to_3d.'),
});

export const commandSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('get_scene'), input: z.object({}) }),
  z.object({ tool: z.literal('render_camera'), input: renderCameraInputSchema }),
  z.object({ tool: z.literal('check_scene'), input: checkSceneInputSchema }),
  z.object({
    tool: z.literal('list_robots'),
    input: z.object({
      page: z.number().int().min(1).default(1),
      search: z.string().max(100).default(''),
    }),
  }),
  z.object({ tool: z.literal('apply_scene_operations'), input: editInputSchema }),
  z.object({ tool: z.literal('place_object'), input: placeObjectInputSchema }),
  z.object({ tool: z.literal('set_object_physics'), input: objectPhysicsInputSchema }),
  z.object({ tool: z.literal('save_scene'), input: saveInputSchema }),
  z.object({ tool: z.literal('add_robot'), input: robotInputSchema }),
  z.object({ tool: z.literal('add_table'), input: tableInputSchema }),
  z.object({ tool: z.literal('detect_table'), input: detectTableInputSchema }),
  z.object({ tool: z.literal('add_scan_table'), input: scanTableInputSchema }),
  z.object({ tool: z.literal('list_assets'), input: assetListInputSchema }),
  z.object({ tool: z.literal('add_asset'), input: assetInputSchema }),
]);

export type SceneOperation = z.infer<typeof sceneOperationSchema>;
export type RenderCameraInput = z.infer<typeof renderCameraInputSchema>;
/** What the editor returns for `render_camera`; the server sends `image` as MCP image content. */
export interface RenderCameraResult {
  image: string;
  mimeType: 'image/png';
  width: number;
  height: number;
  camera: string | null;
  fovy: number;
  clipping: { near: number; far: number };
  splat: 'none' | 'hidden' | 'shown' | 'failed';
}
export type EditorCommand = z.infer<typeof commandSchema>;
export interface CommandResult {
  data?: unknown;
  error?: string;
}
export interface PendingCommand {
  id: string;
  remainingMs: number;
  command: EditorCommand;
}
