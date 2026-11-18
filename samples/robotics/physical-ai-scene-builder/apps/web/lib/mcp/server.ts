// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

import { requestOrigin } from '../http/requestOrigin';
import { dispatchCommand, exposedTools } from './bridge';
import {
  assetInputSchema,
  assetListInputSchema,
  checkSceneInputSchema,
  detectTableInputSchema,
  fitCameraInputSchema,
  scanTableInputSchema,
  editInputSchema,
  imageJobInputSchema,
  imageJobStartSchema,
  objectPhysicsInputSchema,
  placeObjectInputSchema,
  renderCameraInputSchema,
  robotInputSchema,
  saveInputSchema,
  tableInputSchema,
  type EditorCommand,
  type McpToolName,
  type RenderCameraResult,
} from './contracts';
import { fitCamera } from './cameraFit';
import { getImageJob, listImages, startImageJob } from './imageJobs';
import { MCP_SKILLS, readSkill, skillPrompt } from './skills';

export async function handleMcpRequest(request: Request, editorToken: string): Promise<Response> {
  const server = new McpServer(
    { name: 'physical-ai-scene-builder', version: '0.1.1' },
    {
      instructions:
        'Author the scene attached by the user in the browser. First call get_scene. Coordinates are MuJoCo Z-up in meters, mass in kg. Read the compiler angle unit and existing MJCF. Use add_table for fixed four-legged tables and list_robots/add_robot for catalog robots such as SO101, and list_assets/add_asset for saved library objects, including image-to-3D generated objects. To generate a new object from an image, call list_images, start_image_to_3d, poll get_image_to_3d_job until it finishes, then add_asset with its libraryAssetId. Position the robot root on the tabletop using apply_scene_operations after reading get_scene. In a scanned room (splat backdrop), call detect_table and add_scan_table so objects have a table to rest on; scan surfaces do not collide by themselves. Use place_object to set objects down on tables or beside each other instead of computing heights, and set_object_physics to give generated objects their real-world size and mass. To check your work, call render_camera for a scene camera (or a free view) and compare the image with the photo the user shared; it shows exactly what recordings capture. Before save_scene, call check_scene and fix its errors (overlaps, falling or unreachable objects). Use small atomic batches, inspect the returned revision after every edit, and save_scene when finished. Do not claim physical reachability from compilation alone. The browser must stay open in Build mode. Existing editor undo works for agent edits. To recreate a photographed workspace for a task, first read the skill resource skill://replicate-scene and follow it.',
    },
  );
  const exposed = exposedTools(editorToken);
  // Hidden tools are never registered, so they are absent from tools/list and calls fail as unknown.
  const expose = (name: McpToolName) => exposed.has(name);
  // Image-to-3D runs on the server for minutes, outside the browser command relay and its timeout.
  const local = async (run: () => unknown) => {
    try {
      return { content: [{ type: 'text' as const, text: JSON.stringify(await run()) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
          },
        ],
        isError: true,
      };
    }
  };
  const execute = async (command: EditorCommand) => {
    const result = await dispatchCommand(editorToken, command);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result.error ? { error: result.error } : result.data),
        },
      ],
      isError: Boolean(result.error),
    };
  };
  if (expose('get_scene'))
    server.registerTool(
      'get_scene',
      {
        description:
          'Read the attached working scene, MJCF, node names, current revision, and editor status. Includes unsaved changes. Compiled body and camera nodes include their current column-major worldMatrix in MuJoCo Z-up coordinates; use these live poses rather than assuming the robot is at zero joint angles when positioning cameras.',
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true },
      },
      () => execute({ tool: 'get_scene', input: {} }),
    );
  if (expose('render_camera'))
    server.registerTool(
      'render_camera',
      {
        description:
          "Render a PNG image of the working scene from a named scene camera (exactly what that camera records: resolution, field of view, clipping, MuJoCo lighting, and the scanned room backdrop) or from a free view (position, target, fovy). Use it to compare the scene with the user's photo and to check placements. Renders take a few seconds; the editor tab must be visible.",
        inputSchema: renderCameraInputSchema,
        annotations: { readOnlyHint: true },
      },
      async (input) => {
        const result = await dispatchCommand(editorToken, { tool: 'render_camera', input });
        if (result.error) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }],
            isError: true,
          };
        }
        const { image, mimeType, ...details } = result.data as RenderCameraResult;
        return {
          content: [
            { type: 'image' as const, data: image, mimeType },
            { type: 'text' as const, text: JSON.stringify(details) },
          ],
        };
      },
    );
  if (expose('fit_camera'))
    server.registerTool(
      'fit_camera',
      {
        description:
          'Estimate the camera that took a photo from where known world points appear in it, such as the 4 table-top corners (after add_table or add_scan_table) and optionally the robot base. Returns a world position, target, and fovy ready for add_camera or aim_camera, the per-point pixel error (a few pixels is a good fit; large errors mean a mismatched point order or table size), and rollDegrees, the photo tilt that a level camera leaves out. Pass fovy when the lens is known. Pure calculation: it does not change the scene.',
        inputSchema: fitCameraInputSchema,
        annotations: { readOnlyHint: true },
      },
      (input) => local(() => fitCamera(input)),
    );
  if (expose('check_scene'))
    server.registerTool(
      'check_scene',
      {
        description:
          "Check the working scene for problems that make data generation fail: objects starting inside other geometry, objects that fall or slide when simulated for settleSeconds (the scene is restored afterwards), objects beyond or near the edge of a robot arm's reach, objects no camera sees, and missing or unnamed cameras. Each issue has a level (error or warning), the node name, and a fix you can apply with the scene tools. ok is false when any error remains.",
        inputSchema: checkSceneInputSchema,
        annotations: { readOnlyHint: true },
      },
      (input) => execute({ tool: 'check_scene', input }),
    );
  if (expose('apply_scene_operations'))
    server.registerTool(
      'apply_scene_operations',
      {
        description:
          'Add dynamic objects or fixed furniture, world cameras (add_camera; move and re-aim an existing one in place with aim_camera), body-mounted cameras (add_mounted_camera), lights, and open-top containers (add_container: a tray with a placement target, named container for pick-and-place); edit attributes; delete or duplicate existing named nodes. Mounted camera position and quaternion are in the named parent body local frame, so the camera follows the robot link. Sizes use native MuJoCo conventions, NOT full dimensions. One atomic compile-before-commit batch and undo entry. New nodes can be targeted after calling get_scene again.',
        inputSchema: editInputSchema,
        annotations: { destructiveHint: true, idempotentHint: true },
      },
      (input) => execute({ tool: 'apply_scene_operations', input }),
    );
  if (expose('place_object'))
    server.registerTool(
      'place_object',
      {
        description:
          'Move a top-level object and set it down resting on whatever is below it (found by casting rays under its footprint; the splat backdrop is ignored). Give exactly one of: at (world X, Y), on (a body or world geom such as a scan table; its centre plus offset), or beside (another object, a world X, Y direction, and a gap). yaw sets an upright orientation in degrees. Reports the support it rests on. One undo entry; read get_scene afterwards for the revision.',
        inputSchema: placeObjectInputSchema,
        annotations: { destructiveHint: false, idempotentHint: true },
      },
      (input) => execute({ tool: 'place_object', input }),
    );
  if (expose('set_object_physics'))
    server.registerTool(
      'set_object_physics',
      {
        description:
          "Set an object's real-world physics: largestDimension (meters) or scale resizes it uniformly while keeping its bottom on its support (meshes get a copy of their own, so other objects keep their size); mass (kg) is spread over its colliding geoms; friction sets sliding (or [sliding, torsional, rolling]) friction. Typical values: a 6 cm cube 0.05-0.2 kg, a mug 0.3 kg, friction 0.8-1.2. Returns the resulting dimensions and mass.",
        inputSchema: objectPhysicsInputSchema,
        annotations: { destructiveHint: false, idempotentHint: true },
      },
      (input) => execute({ tool: 'set_object_physics', input }),
    );
  if (expose('save_scene'))
    server.registerTool(
      'save_scene',
      {
        description:
          'Save the current compiled scene and assets to the project. Read get_scene first and use its revision.',
        inputSchema: saveInputSchema,
        annotations: { destructiveHint: false, idempotentHint: true },
      },
      (input) => execute({ tool: 'save_scene', input }),
    );
  if (expose('list_robots'))
    server.registerTool(
      'list_robots',
      {
        description:
          'Browse the robot catalog before adding a robot. Paginated, 24 robots per page.',
        inputSchema: z.object({
          page: z.number().int().min(1).default(1),
          search: z.string().max(100).default(''),
        }),
        annotations: { readOnlyHint: true },
      },
      (input) => execute({ tool: 'list_robots', input }),
    );
  if (expose('add_table'))
    server.registerTool(
      'add_table',
      {
        description:
          'Add a fixed four-legged table as one body and undo entry. Dimensions are FULL width, depth, and floor-to-tabletop height in meters (not MuJoCo half-extents). Position is the floor-level center. topThickness must be less than height; two leg widths must fit within width and depth. Default tabletop is at Z=0.75. Read get_scene afterward for the body name and revision.',
        inputSchema: tableInputSchema,
        annotations: { destructiveHint: false, idempotentHint: true },
      },
      (input) => execute({ tool: 'add_table', input }),
    );
  if (expose('detect_table'))
    server.registerTool(
      'detect_table',
      {
        description:
          'Find flat table tops in the scanned room (splat backdrop) from its heightfield and propose collision tables: centre, size, yaw (degrees, from the table edges), top height, area, fill (how much of the rectangle is scanned surface), flatness, and distance from the robot. With a robot, only surface within workspaceRadius of its base is used and proposals nearest the robot come first. Scans of dark or shiny tops have holes, so check a proposal with render_camera before add_scan_table. Read-only.',
        inputSchema: detectTableInputSchema,
        annotations: { readOnlyHint: true },
      },
      (input) => execute({ tool: 'detect_table', input }),
    );
  if (expose('add_scan_table'))
    server.registerTool(
      'add_scan_table',
      {
        description:
          'Add a hidden collision table (a scan_table box, invisible in camera images) whose top is at top, centred on center with size and yaw, so objects rest on the scanned table. Use the values from detect_table. One undo entry; read get_scene afterwards.',
        inputSchema: scanTableInputSchema,
        annotations: { destructiveHint: false, idempotentHint: true },
      },
      (input) => execute({ tool: 'add_scan_table', input }),
    );
  if (expose('add_robot'))
    server.registerTool(
      'add_robot',
      {
        description:
          'Add a catalog robot using the editor asset download and namespacing workflow. Defaults to the origin or splat tabletop. Read get_scene afterward to position the new body.',
        inputSchema: robotInputSchema,
        annotations: { destructiveHint: false, idempotentHint: true },
      },
      (input) => execute({ tool: 'add_robot', input }),
    );
  if (expose('list_assets'))
    server.registerTool(
      'list_assets',
      {
        description:
          'Browse saved library objects: image-to-3D generated objects, uploaded meshes, saved primitives, and custom shapes. Paginated, 24 per page. Only objects with placeable=true can be added.',
        inputSchema: assetListInputSchema,
        annotations: { readOnlyHint: true },
      },
      (input) => execute({ tool: 'list_assets', input }),
    );
  if (expose('add_asset'))
    server.registerTool(
      'add_asset',
      {
        description:
          'Add a saved library object from list_assets using the editor Asset Browser workflow. Position is the object origin in world coordinates (default [0, 0, 0.5]). Read get_scene afterward for the new body name and revision.',
        inputSchema: assetInputSchema,
        annotations: { destructiveHint: false, idempotentHint: true },
      },
      (input) => execute({ tool: 'add_asset', input }),
    );
  if (expose('list_images'))
    server.registerTool(
      'list_images',
      {
        description:
          'List images shared with you for image-to-3D. The user shares images from the editor MCP dialog. If your client has a shell and the user gives you the MCP token, you can also upload one with: curl -H "Authorization: Bearer <token>" -F image=@photo.png <uploadUrl>. Images are PNG, JPEG, or WebP up to 20 MB and last only for this MCP connection.',
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true },
      },
      () =>
        local(() => ({
          images: listImages(editorToken),
          uploadUrl: `${requestOrigin(request)}/api/mcp/images`,
        })),
    );
  if (expose('start_image_to_3d'))
    server.registerTool(
      'start_image_to_3d',
      {
        description:
          'Start generating a textured library object from a shared image with TRELLIS.2. Returns a job immediately; generation takes minutes. Poll get_image_to_3d_job every 10-30 seconds. Requires the user to have started the image-to-3D service. One generation runs at a time.',
        inputSchema: imageJobStartSchema,
        annotations: { destructiveHint: false, idempotentHint: true },
      },
      (input) => local(() => startImageJob(editorToken, input)),
    );
  if (expose('get_image_to_3d_job'))
    server.registerTool(
      'get_image_to_3d_job',
      {
        description:
          'Read an image-to-3D job: status (running, succeeded, failed), current stage, recent logs, and error. When succeeded, call add_asset with libraryAssetId to place the object.',
        inputSchema: imageJobInputSchema,
        annotations: { readOnlyHint: true },
      },
      ({ jobId }) => local(() => getImageJob(editorToken, jobId)),
    );
  // Skills are guidance, not commands, so they are offered whatever tools are exposed.
  const replicate = MCP_SKILLS.replicate_scene;
  server.registerPrompt(
    'replicate_scene',
    {
      title: replicate.title,
      description: replicate.description,
      argsSchema: {
        task: z.string().max(500).optional().describe('What the robot should do, in one sentence.'),
        photos: z
          .string()
          .max(500)
          .optional()
          .describe('Which attached photos to match, and anything they do not show.'),
      },
    },
    async ({ task, photos }) => ({
      description: replicate.description,
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: skillPrompt(await readSkill('replicate_scene'), task, photos),
          },
        },
      ],
    }),
  );
  server.registerResource(
    'replicate-scene',
    'skill://replicate-scene',
    { title: replicate.title, description: replicate.description, mimeType: 'text/markdown' },
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: 'text/markdown', text: await readSkill('replicate_scene') },
      ],
    }),
  );
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: 256 * 1024,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
