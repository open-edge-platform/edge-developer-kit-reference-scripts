// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Simulation } from '@mujoco-studio/mujoco';
import { SPLAT_BACKDROP_BODY } from '@mujoco-studio/types';

/**
 * `check_scene`: what would make Generate fail, found with the browser's compiled MuJoCo model.
 *
 * Overlaps use the same rule as the native preflight (`robots/overlaps.py`): a free object more
 * than 5 mm inside other geometry. Support is tested by simulating the live model for a moment and
 * restoring its exact state, so nothing changes in the editor.
 */

export type SceneIssueLevel = 'error' | 'warning';
export type SceneIssueCode =
  | 'overlap'
  | 'falls'
  | 'settles'
  | 'unstable'
  | 'unreachable'
  | 'near_reach_limit'
  | 'not_visible'
  | 'no_camera'
  | 'unnamed_camera'
  | 'camera_resolution'
  | 'no_objects'
  | 'no_robot'
  | 'no_container'
  | 'container_unreachable'
  | 'container_too_small'
  | 'grasp_blocked'
  | 'no_light';

export interface SceneIssue {
  level: SceneIssueLevel;
  code: SceneIssueCode;
  /** Scene node the issue is about, as named in get_scene. */
  node?: string;
  message: string;
  /** A change the agent can make with the scene tools. */
  fix: string;
}

export interface SceneCheckResult {
  ok: boolean;
  settleSeconds: number;
  robots: { name: string; reach: number; toolSite: string }[];
  objects: {
    name: string;
    moved: number;
    drop: number;
    /**
     * Free space beside the object along its two horizontal axes (meters, capped at
     * GRASP_CLEARANCE_RANGE): what the open gripper jaws have on each side. Null without a robot.
     */
    clearance: GraspClearance[] | null;
  }[];
  cameras: { name: string; resolution: [number, number] | null }[];
  issues: SceneIssue[];
}

/** Resting contacts penetrate by well under a millimetre; authored overlaps are much deeper. */
export const OVERLAP_TOLERANCE = 0.005;
/** A drop larger than this means the object had nothing under it. */
export const FALL_DISTANCE = 0.05;
/** Movement above this while settling means it was resting badly (edge, tilt, slight float). */
export const SETTLE_DISTANCE = 0.01;

/**
 * Free space the open SO-101 jaws need beside an object (meters, at the object's height): the
 * fixed finger on one side, the opened moving jaw on the other. Calibrated against the native
 * planner's jaw sweep (`grasp_blocked`), see docs/features.md.
 */
export const FIXED_JAW_CLEARANCE = 0.015;
export const MOVING_JAW_CLEARANCE = 0.04;
/** Probes stop here: farther geometry never blocks a grasp. */
export const GRASP_CLEARANCE_RANGE = 0.2;

export interface GraspClearance {
  /** Horizontal unit axis in world coordinates (the object's x or y axis, flattened). */
  axis: [number, number];
  /** Free space on the +axis and -axis sides. */
  plus: number;
  minus: number;
}

const FREE_JOINT = 0;
const STATE_FIELDS = [
  'qpos',
  'qvel',
  'act',
  'ctrl',
  'qacc_warmstart',
  'qfrc_applied',
  'xfrc_applied',
  'mocap_pos',
  'mocap_quat',
] as const;

type Vec3 = [number, number, number];

function cm(meters: number): string {
  return `${(meters * 100).toFixed(1)} cm`;
}

function vector(array: ArrayLike<number>, index: number): Vec3 {
  return [array[index * 3], array[index * 3 + 1], array[index * 3 + 2]];
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

interface Inventory {
  bodyName: (index: number) => string;
  /** Root bodies (children of world) that move freely: the objects a task can use. */
  objects: number[];
  /** Root bodies with at least two hinge or slide joints in their subtree. */
  robots: number[];
  /** Other root bodies with geometry (tables, containers, pads). */
  fixtures: number[];
}

/** Names Generate and the Simulate task pick as the destination, most preferred first. */
const CONTAINER_NAMES = [
  'container',
  'destination',
  'basket',
  'bin',
  'tray',
  'bowl',
  'box',
  'plate',
];

/** The body pick-and-place would place objects into: the best-named fixed root body. */
function findContainer(found: Inventory): number | null {
  for (const name of CONTAINER_NAMES) {
    const exact = found.fixtures.find((body) => found.bodyName(body).toLowerCase() === name);
    if (exact !== undefined) return exact;
  }
  for (const name of CONTAINER_NAMES) {
    const partial = found.fixtures.find((body) =>
      found.bodyName(body).toLowerCase().includes(name),
    );
    if (partial !== undefined) return partial;
  }
  return null;
}

/** World x/y bounds of the colliding geometry under a root body, or null when it has none. */
function footprint(simulation: Simulation, root: number): [number, number, number, number] | null {
  const model = simulation.model;
  const geomBody = model.geom_bodyid as Int32Array;
  const rootOf = model.body_rootid as Int32Array;
  const contype = model.geom_contype as Int32Array;
  const conaffinity = model.geom_conaffinity as Int32Array;
  const aabb = model.geom_aabb as Float64Array;
  const positions = simulation.geomPositions;
  const rotations = simulation.geomRotations;
  let bounds: [number, number, number, number] | null = null;
  for (let geom = 0; geom < model.ngeom; geom++) {
    if (rootOf[geomBody[geom]] !== root || (contype[geom] === 0 && conaffinity[geom] === 0))
      continue;
    const r = rotations.subarray(geom * 9, geom * 9 + 9);
    const local = aabb.subarray(geom * 6, geom * 6 + 6);
    const center = [0, 1].map(
      (axis) =>
        positions[geom * 3 + axis] +
        r[axis * 3] * local[0] +
        r[axis * 3 + 1] * local[1] +
        r[axis * 3 + 2] * local[2],
    );
    const half = [0, 1].map(
      (axis) =>
        Math.abs(r[axis * 3]) * local[3] +
        Math.abs(r[axis * 3 + 1]) * local[4] +
        Math.abs(r[axis * 3 + 2]) * local[5],
    );
    const box: [number, number, number, number] = [
      center[0] - half[0],
      center[0] + half[0],
      center[1] - half[1],
      center[1] + half[1],
    ];
    bounds = bounds
      ? [
          Math.min(bounds[0], box[0]),
          Math.max(bounds[1], box[1]),
          Math.min(bounds[2], box[2]),
          Math.max(bounds[3], box[3]),
        ]
      : box;
  }
  return bounds;
}

/** Inner x/y half sizes from the container's `<name>__generation_interior` box site, if any. */
function interiorHalfSize(simulation: Simulation, name: string): [number, number] | null {
  const model = simulation.model;
  const siteNames = model.name_siteadr as Int32Array;
  const sizes = model.site_size as Float64Array;
  for (let site = 0; site < model.nsite; site++) {
    if (simulation.nameAt(siteNames[site]) === `${name}__generation_interior`) {
      return [sizes[site * 3], sizes[site * 3 + 1]];
    }
  }
  return null;
}

function inventory(simulation: Simulation): Inventory {
  const model = simulation.model;
  const parent = model.body_parentid as Int32Array;
  const jointAddress = model.body_jntadr as Int32Array;
  const jointBody = model.jnt_bodyid as Int32Array;
  const jointType = model.jnt_type as Int32Array;
  const bodyNames = model.name_bodyadr as Int32Array;
  const rootOf = model.body_rootid as Int32Array;
  const bodyName = (index: number) => simulation.nameAt(bodyNames[index]) || `body ${index}`;
  const objects: number[] = [];
  const robots: number[] = [];
  const fixtures: number[] = [];
  const geomCount = model.body_geomnum as Int32Array;
  const robotJoints = new Map<number, number>();
  for (let joint = 0; joint < model.njnt; joint++) {
    if (jointType[joint] === FREE_JOINT) continue;
    const root = rootOf[jointBody[joint]];
    robotJoints.set(root, (robotJoints.get(root) ?? 0) + 1);
  }
  for (let body = 1; body < model.nbody; body++) {
    if (parent[body] !== 0 || bodyName(body) === SPLAT_BACKDROP_BODY) continue;
    const joint = jointAddress[body];
    if (joint >= 0 && jointType[joint] === FREE_JOINT) objects.push(body);
    else if ((robotJoints.get(body) ?? 0) >= 2) robots.push(body);
    else if (geomCount[body] > 0 || subtreeHasGeoms(body)) fixtures.push(body);
  }
  return { bodyName, objects, robots, fixtures };

  function subtreeHasGeoms(root: number): boolean {
    for (let body = root + 1; body < model.nbody; body++) {
      if (rootOf[body] === root && geomCount[body] > 0) return true;
    }
    return false;
  }
}

/** Sites that mark an arm's tool point, preferred over other robot sites. */
const TOOL_SITE = /grip|tcp|tool|tip|end.?effector|ee$|attach|hand/i;
/** Random arm poses sampled to measure where the tool point can go, fixed for repeatable checks. */
const REACH_SAMPLES = 20_000;
/** Height band (above or below an object) that counts as reaching that object's height. */
const REACH_HEIGHT_BAND = 0.03;
/** Fingers within this tilt from straight down: a comfortable top-down grasp. */
export const COMFORTABLE_GRASP_TILT_DEGREES = 20;
/** The steepest tilt pick-and-place grasps still use; beyond its reach an object is unreachable. */
export const MAX_GRASP_TILT_DEGREES = 45;

interface RobotReach {
  name: string;
  /** World position of the first joint (for example the shoulder). */
  base: Vec3;
  /** Farthest the tool point gets from the base in any pose. */
  reach: number;
  toolSite: string;
  /** Per sampled pose: horizontal distance, height relative to the base, and finger downward cosine. */
  horizontal: Float64Array;
  height: Float64Array;
  down: Float64Array;
}

/** A small deterministic generator (mulberry32), so a scene always gets the same reach. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Samples arm poses (within joint limits) and records where the tool site goes and how its fingers
 * point: from the site's body origin, which sits on the wrist roll axis, to the site. Call inside
 * `withRestoredState`: it overwrites joint positions.
 */
function sampleReach(simulation: Simulation, root: number, name: string): RobotReach | null {
  const model = simulation.model;
  const data = simulation.data;
  const rootOf = model.body_rootid as Int32Array;
  const jointBody = model.jnt_bodyid as Int32Array;
  const jointType = model.jnt_type as Int32Array;
  const jointRange = model.jnt_range as Float64Array;
  const jointQpos = model.jnt_qposadr as Int32Array;
  const siteBody = model.site_bodyid as Int32Array;
  const siteNames = model.name_siteadr as Int32Array;
  const joints: number[] = [];
  for (let joint = 0; joint < model.njnt; joint++) {
    if (rootOf[jointBody[joint]] === root && jointType[joint] !== FREE_JOINT) joints.push(joint);
  }
  const sites: number[] = [];
  for (let site = 0; site < model.nsite; site++) {
    if (rootOf[siteBody[site]] === root) sites.push(site);
  }
  if (!joints.length || !sites.length) return null;
  const baseBody = Math.min(...joints.map((joint) => jointBody[joint]));
  const base = vector(simulation.bodyPositions, baseBody);
  const siteName = (site: number) => simulation.nameAt(siteNames[site]);
  const named = sites.filter((site) => TOOL_SITE.test(siteName(site)));
  const sitePositions = data.site_xpos as Float64Array;
  const tool = (named.length ? named : sites).reduce((best, site) =>
    distance(vector(sitePositions, site), base) > distance(vector(sitePositions, best), base)
      ? site
      : best,
  );
  const toolBody = siteBody[tool];
  const qpos = data.qpos as Float64Array;
  const next = random(0x5eed);
  const horizontal = new Float64Array(REACH_SAMPLES);
  const height = new Float64Array(REACH_SAMPLES);
  const down = new Float64Array(REACH_SAMPLES);
  let reach = 0;
  for (let sample = 0; sample < REACH_SAMPLES; sample++) {
    for (const joint of joints) {
      // Unlimited joints keep a [0, 0] range (the WASM build cannot read jnt_limited).
      const limited = jointRange[joint * 2 + 1] > jointRange[joint * 2];
      const low = limited ? jointRange[joint * 2] : -Math.PI;
      const high = limited ? jointRange[joint * 2 + 1] : Math.PI;
      qpos[jointQpos[joint]] = low + (high - low) * next();
    }
    simulation.mujoco.mj_kinematics(simulation.model, data);
    const point = vector(sitePositions, tool);
    const origin = vector(simulation.bodyPositions, toolBody);
    const finger = [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]];
    const length = Math.hypot(...finger) || 1;
    horizontal[sample] = Math.hypot(point[0] - base[0], point[1] - base[1]);
    height[sample] = point[2] - base[2];
    down[sample] = -finger[2] / length;
    reach = Math.max(reach, distance(point, base));
  }
  return { name, base, reach, toolSite: siteName(tool), horizontal, height, down };
}

/** Farthest horizontal reach at a height (relative to the base) with fingers within `tilt` of down. */
function reachAt(robot: RobotReach, height: number, tiltDegrees: number): number {
  const minDown = Math.cos((tiltDegrees * Math.PI) / 180);
  let best = 0;
  for (let sample = 0; sample < robot.horizontal.length; sample++) {
    if (robot.down[sample] < minDown) continue;
    if (Math.abs(robot.height[sample] - height) > REACH_HEIGHT_BAND) continue;
    best = Math.max(best, robot.horizontal[sample]);
  }
  return best;
}

/** Saves the live state, runs `work`, and restores it exactly (nothing changes in the editor). */
function withRestoredState<T>(simulation: Simulation, work: () => T): T {
  const data = simulation.data as unknown as Record<string, Float64Array> & { time: number };
  const saved = STATE_FIELDS.flatMap((field) =>
    data[field] && data[field].length ? [[field, Float64Array.from(data[field])] as const] : [],
  );
  const time = data.time;
  try {
    return work();
  } finally {
    for (const [field, values] of saved) data[field].set(values);
    data.time = time;
    simulation.forward();
  }
}

/**
 * Free space beside a free object along its two horizontal axes, from horizontal rays at the
 * object's bottom, middle, and top (and a pad width to either side). Rays pass through the object,
 * robots, the splat backdrop, and geometry that collides with nothing.
 */
function graspClearance(simulation: Simulation, body: number, robots: number[]): GraspClearance[] {
  const mujoco = simulation.mujoco as unknown as {
    mj_ray: (...args: unknown[]) => number;
    IntBuffer: new (size: number) => { GetView(): Int32Array; delete(): void };
  };
  const model = simulation.model;
  const rootOf = model.body_rootid as Int32Array;
  const geomBody = model.geom_bodyid as Int32Array;
  const contype = model.geom_contype as Int32Array;
  const conaffinity = model.geom_conaffinity as Int32Array;
  const aabb = model.geom_aabb as Float64Array;
  const backdrop = (() => {
    const names = model.name_bodyadr as Int32Array;
    for (let index = 1; index < model.nbody; index++) {
      if (simulation.nameAt(names[index]) === SPLAT_BACKDROP_BODY) return index;
    }
    return -1;
  })();
  const skipped = new Set([body, ...robots, backdrop]);
  const rotation = simulation.bodyRotations.subarray(body * 9, body * 9 + 9);
  const center = vector(simulation.bodyPositions, body);
  const axes: [number, number][] = [];
  for (const column of [0, 1]) {
    const x = rotation[column];
    const y = rotation[3 + column];
    const length = Math.hypot(x, y);
    if (length > 1e-6) axes.push([x / length, y / length]);
  }
  if (axes.length < 2) axes.splice(0, axes.length, [1, 0], [0, 1]);

  // The object's extent along each direction and its height range, from its geoms' boxes.
  const corners: Vec3[] = [];
  for (let geom = 0; geom < model.ngeom; geom++) {
    if (rootOf[geomBody[geom]] !== body || (contype[geom] === 0 && conaffinity[geom] === 0))
      continue;
    const r = simulation.geomRotations.subarray(geom * 9, geom * 9 + 9);
    const p = vector(simulation.geomPositions, geom);
    const local = aabb.subarray(geom * 6, geom * 6 + 6);
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) {
          const l = [local[0] + sx * local[3], local[1] + sy * local[4], local[2] + sz * local[5]];
          corners.push(
            [0, 1, 2].map(
              (axis) =>
                p[axis] + r[axis * 3] * l[0] + r[axis * 3 + 1] * l[1] + r[axis * 3 + 2] * l[2],
            ) as Vec3,
          );
        }
  }
  if (!corners.length) return [];
  const bottom = Math.min(...corners.map((corner) => corner[2]));
  const top = Math.max(...corners.map((corner) => corner[2]));
  const heights = [bottom + Math.min(0.008, (top - bottom) / 2), (bottom + top) / 2, top];
  const extent = (direction: [number, number]) =>
    Math.max(
      ...corners.map(
        (corner) => (corner[0] - center[0]) * direction[0] + (corner[1] - center[1]) * direction[1],
      ),
    );

  const hitGeom = new mujoco.IntBuffer(1);
  const free = (direction: [number, number]): number => {
    const reach = extent(direction);
    const side: [number, number] = [-direction[1], direction[0]];
    let nearest = GRASP_CLEARANCE_RANGE;
    for (const height of heights) {
      for (const offset of [-0.007, 0, 0.007]) {
        let origin: Vec3 = [center[0] + side[0] * offset, center[1] + side[1] * offset, height];
        let travelled = 0;
        for (let attempt = 0; attempt < 16; attempt++) {
          const hit = mujoco.mj_ray(
            model,
            simulation.data,
            origin,
            [direction[0], direction[1], 0],
            null,
            true,
            body,
            hitGeom,
            null,
          );
          const geom = hitGeom.GetView()[0];
          if (hit < 0 || geom < 0) break;
          travelled += hit;
          if (travelled - reach >= nearest) break;
          const passThrough =
            skipped.has(rootOf[geomBody[geom]]) || (contype[geom] === 0 && conaffinity[geom] === 0);
          if (!passThrough) {
            nearest = Math.max(0, travelled - reach);
            break;
          }
          travelled += 1e-4;
          origin = [
            origin[0] + direction[0] * (hit + 1e-4),
            origin[1] + direction[1] * (hit + 1e-4),
            height,
          ];
        }
      }
    }
    return nearest;
  };
  try {
    return axes.map((axis) => ({
      axis,
      plus: free(axis),
      minus: free([-axis[0], -axis[1]]),
    }));
  } finally {
    hitGeom.delete();
  }
}

/** True when the jaws fit along this axis: the fixed finger on one side, the moving jaw opposite. */
export function graspFits(clearance: GraspClearance): boolean {
  const { plus, minus } = clearance;
  return (
    (plus >= MOVING_JAW_CLEARANCE && minus >= FIXED_JAW_CLEARANCE) ||
    (minus >= MOVING_JAW_CLEARANCE && plus >= FIXED_JAW_CLEARANCE)
  );
}

/** A free object that starts more than OVERLAP_TOLERANCE inside other geometry, deepest first. */
export interface ObjectOverlap {
  body: string;
  other: string;
  depth: number;
}

/**
 * Free objects starting inside other geometry (the robot, a table, another object), from the
 * current contacts: the deepest overlap per pair, deepest first. Call after `forward`.
 */
export function objectOverlaps(simulation: Simulation): ObjectOverlap[] {
  const objects = inventory(simulation);
  const model = simulation.model;
  const data = simulation.data;
  const geomBody = model.geom_bodyid as Int32Array;
  const rootOf = model.body_rootid as Int32Array;
  const geomNames = model.name_geomadr as Int32Array;
  const free = new Set(objects.objects);
  const deepest = new Map<string, ObjectOverlap>();
  for (let index = 0; index < data.ncon; index++) {
    const contact = data.contact.get(index);
    if (!contact) continue;
    const depth = -contact.dist;
    const geoms = [contact.geom1, contact.geom2];
    (contact as { delete?: () => void }).delete?.();
    if (depth <= OVERLAP_TOLERANCE) continue;
    const roots = geoms.map((geom) => rootOf[geomBody[geom]]);
    if (roots[0] === roots[1]) continue;
    const side = free.has(roots[0]) ? 0 : free.has(roots[1]) ? 1 : -1;
    if (side < 0) continue;
    const otherGeom = geoms[1 - side];
    const otherRoot = roots[1 - side];
    const other =
      otherRoot > 0
        ? objects.bodyName(otherRoot)
        : simulation.nameAt(geomNames[otherGeom]) || 'the world';
    const body = objects.bodyName(roots[side]);
    const key = `${body}\u0000${other}`;
    if (depth > (deepest.get(key)?.depth ?? 0)) deepest.set(key, { body, other, depth });
  }
  return [...deepest.values()].sort((a, b) => b.depth - a.depth);
}

function overlapIssues(simulation: Simulation): SceneIssue[] {
  return objectOverlaps(simulation).map(({ body, other, depth }) => ({
    level: 'error',
    code: 'overlap',
    node: body,
    message: `'${body}' starts ${(depth * 1000).toFixed(0)} mm inside '${other}'.`,
    fix: `Move '${body}' so it rests on '${other}' instead of inside it: raise or shift its pos with apply_scene_operations set_attribute.`,
  }));
}

/** Steps the live model for `seconds` and measures each object's motion (state restored). */
function settle(
  simulation: Simulation,
  objects: number[],
  seconds: number,
): { moved: number; drop: number; finite: boolean }[] {
  return withRestoredState(simulation, () => {
    const start = objects.map((body) => vector(simulation.bodyPositions, body));
    simulation.step(Math.max(1, Math.round(seconds / simulation.timestep)));
    return objects.map((body, index) => {
      const end = vector(simulation.bodyPositions, body);
      const finite = end.every(Number.isFinite);
      return {
        moved: finite ? distance(start[index], end) : Infinity,
        drop: finite ? start[index][2] - end[2] : Infinity,
        finite,
      };
    });
  });
}

function visibleFromCamera(
  point: Vec3,
  position: Vec3,
  rotation: ArrayLike<number>,
  offset: number,
  fovy: number,
  aspect: number,
  near: number,
): boolean {
  // cam_xmat is row-major; its columns are the camera's x (right), y (up), and z (backward) axes.
  const d: Vec3 = [point[0] - position[0], point[1] - position[1], point[2] - position[2]];
  const axis = (column: number) =>
    d[0] * rotation[offset + column] +
    d[1] * rotation[offset + 3 + column] +
    d[2] * rotation[offset + 6 + column];
  const depth = -axis(2);
  if (depth <= near) return false;
  const halfHeight = Math.tan((fovy * Math.PI) / 360) * depth;
  return Math.abs(axis(1)) <= halfHeight && Math.abs(axis(0)) <= halfHeight * aspect;
}

/** The destination exists, the robot reaches it, and each object fits its opening. */
function containerIssues(
  simulation: Simulation,
  found: Inventory,
  robots: RobotReach[],
): SceneIssue[] {
  const container = findContainer(found);
  if (container === null) {
    return [
      {
        level: 'warning',
        code: 'no_container',
        message:
          'No body looks like a destination (container, bin, tray, bowl, ...), so Generate has nowhere to place objects.',
        fix: "Add one with add_container, or name the destination body 'container'.",
      },
    ];
  }
  const issues: SceneIssue[] = [];
  const name = found.bodyName(container);
  const bounds = footprint(simulation, container);
  const position = vector(simulation.bodyPositions, container);
  const center: Vec3 = bounds
    ? [(bounds[0] + bounds[1]) / 2, (bounds[2] + bounds[3]) / 2, position[2]]
    : position;
  if (robots.length) {
    const fits = robots.some((robot) => {
      const gap = Math.hypot(center[0] - robot.base[0], center[1] - robot.base[1]);
      return gap <= reachAt(robot, center[2] - robot.base[2], MAX_GRASP_TILT_DEGREES);
    });
    if (!fits) {
      issues.push({
        level: 'error',
        code: 'container_unreachable',
        node: name,
        message: `No robot can reach the middle of '${name}', so objects cannot be placed in it.`,
        fix: `Move '${name}' closer to the robot base.`,
      });
    }
  }
  const interior = interiorHalfSize(simulation, name);
  const opening: [number, number] | null = interior
    ? [interior[0] * 2, interior[1] * 2]
    : bounds
      ? [bounds[1] - bounds[0], bounds[3] - bounds[2]]
      : null;
  if (opening) {
    for (const body of found.objects) {
      const objectBounds = footprint(simulation, body);
      if (!objectBounds) continue;
      const size = [objectBounds[1] - objectBounds[0], objectBounds[3] - objectBounds[2]].sort(
        (a, b) => a - b,
      );
      const room = [...opening].sort((a, b) => a - b);
      if (size[0] >= room[0] || size[1] >= room[1]) {
        const object = found.bodyName(body);
        issues.push({
          level: 'warning',
          code: 'container_too_small',
          node: object,
          message: `'${object}' (${cm(size[1])} x ${cm(size[0])}) does not fit the ${interior ? 'inside' : 'outline'} of '${name}' (${cm(room[1])} x ${cm(room[0])}).`,
          fix: `Use a larger container (add_container with a bigger size) or a smaller object.`,
        });
      }
    }
  }
  return issues;
}

export function checkScene(simulation: Simulation, settleSeconds = 1): SceneCheckResult {
  const model = simulation.model;
  const found = inventory(simulation);
  const issues: SceneIssue[] = [];
  simulation.forward();
  issues.push(...overlapIssues(simulation));
  const clearances = found.robots.length
    ? found.objects.map((body) => graspClearance(simulation, body, found.robots))
    : null;

  const motion = settle(simulation, found.objects, settleSeconds);
  const objects = found.objects.map((body, index) => ({
    name: found.bodyName(body),
    moved: motion[index].moved,
    drop: motion[index].drop,
    clearance: clearances ? clearances[index] : null,
  }));
  for (const [index, object] of objects.entries()) {
    if (!motion[index].finite) {
      issues.push({
        level: 'error',
        code: 'unstable',
        node: object.name,
        message: `The simulation became unstable around '${object.name}' within ${settleSeconds} s.`,
        fix: `Check '${object.name}' for extreme mass, size, or deep overlaps, and fix those first.`,
      });
    } else if (object.drop > FALL_DISTANCE) {
      issues.push({
        level: 'error',
        code: 'falls',
        node: object.name,
        message: `'${object.name}' falls ${cm(object.drop)} in ${settleSeconds} s: nothing holds it up.`,
        fix: `Put '${object.name}' on a support: set its z so its bottom touches the table top, or add a table under it (add_table, or a Splat table for scanned rooms).`,
      });
    } else if (object.moved > SETTLE_DISTANCE) {
      issues.push({
        level: 'warning',
        code: 'settles',
        node: object.name,
        message: `'${object.name}' moves ${cm(object.moved)} while settling (it floats slightly, tips, or slides).`,
        fix: `Lower '${object.name}' onto its support and keep it clear of edges and slopes.`,
      });
    }
  }

  const robots = withRestoredState(simulation, () =>
    found.robots.flatMap((body) => sampleReach(simulation, body, found.bodyName(body)) ?? []),
  );
  if (!found.robots.length) {
    issues.push({
      level: 'warning',
      code: 'no_robot',
      message: 'The scene has no robot arm.',
      fix: 'Add one with list_robots and add_robot.',
    });
  }
  if (!found.objects.length) {
    issues.push({
      level: 'warning',
      code: 'no_objects',
      message: 'The scene has no movable objects for a task.',
      fix: 'Add objects with free joints: add_asset, or add_primitive with fixed=false.',
    });
  }
  if (robots.length) {
    for (const body of found.objects) {
      const name = found.bodyName(body);
      const position = vector(simulation.bodyPositions, body);
      // The robot that reaches this object most comfortably.
      const options = robots.map((robot) => {
        const gap = Math.hypot(position[0] - robot.base[0], position[1] - robot.base[1]);
        const height = position[2] - robot.base[2];
        return {
          robot,
          gap,
          comfortable: reachAt(robot, height, COMFORTABLE_GRASP_TILT_DEGREES),
          maximum: reachAt(robot, height, MAX_GRASP_TILT_DEGREES),
        };
      });
      const best = options.sort((a, b) => b.maximum - b.gap - (a.maximum - a.gap))[0];
      const { robot, gap, comfortable, maximum } = best;
      const where = `'${name}' is ${cm(gap)} (horizontally) from the base of '${robot.name}'`;
      if (gap > maximum) {
        issues.push({
          level: 'error',
          code: 'unreachable',
          node: name,
          message: `${where}; at that height its gripper reaches at most ${cm(maximum)} pointing down.`,
          fix: `Move '${name}' within about ${cm(comfortable)} of the robot base, or move the robot closer.`,
        });
      } else if (gap > comfortable) {
        issues.push({
          level: 'warning',
          code: 'near_reach_limit',
          node: name,
          message: `${where}; beyond ${cm(comfortable)} the gripper must tilt more than ${COMFORTABLE_GRASP_TILT_DEGREES} degrees and grasps often fail.`,
          fix: `Move '${name}' within about ${cm(comfortable)} of the robot base.`,
        });
      }
    }
  }

  if (found.objects.length && found.robots.length) {
    issues.push(...containerIssues(simulation, found, robots));
  }
  for (const object of objects) {
    if (!object.clearance?.length || object.clearance.some(graspFits)) continue;
    const sides = object.clearance
      .flatMap(({ plus, minus }) => [plus, minus])
      .map((space) => cm(space))
      .join(', ');
    issues.push({
      level: 'warning',
      code: 'grasp_blocked',
      node: object.name,
      message: `The open gripper does not fit beside '${object.name}' from any side (free space ${sides}): it needs ${cm(FIXED_JAW_CLEARANCE)} on one side and ${cm(MOVING_JAW_CLEARANCE)} on the opposite side.`,
      fix: `Move '${object.name}' at least ${cm(MOVING_JAW_CLEARANCE)} away from container walls and other objects on one side (place_object), or rotate it so a clear side faces the gap.`,
    });
  }
  if (model.nlight === 0) {
    issues.push({
      level: 'warning',
      code: 'no_light',
      message:
        'The scene has no lights, so cameras see it lit only by the headlight, unlike a real room.',
      fix: 'Add a light above the workspace (apply_scene_operations add_light), lit like the room in the reference photos.',
    });
  }

  const cameraNames = model.name_camadr as Int32Array;
  const resolutions = model.cam_resolution as Int32Array;
  const fovys = model.cam_fovy as Float64Array;
  const cameras = Array.from({ length: model.ncam }, (_, index) => {
    const width = resolutions[index * 2];
    const height = resolutions[index * 2 + 1];
    return {
      index,
      name: simulation.nameAt(cameraNames[index]),
      resolution: width > 1 && height > 1 ? ([width, height] as [number, number]) : null,
    };
  });
  if (!cameras.length) {
    issues.push({
      level: 'warning',
      code: 'no_camera',
      message: 'The scene has no cameras, so recorded episodes have no images to train on.',
      fix: 'Add a world camera (add_camera) and a wrist camera (add_mounted_camera on the gripper).',
    });
  }
  for (const camera of cameras) {
    if (!camera.name) {
      issues.push({
        level: 'error',
        code: 'unnamed_camera',
        message: `Camera ${camera.index} has no name, so recordings cannot refer to it.`,
        fix: 'Give every camera a unique name.',
      });
    } else if (!camera.resolution) {
      issues.push({
        level: 'warning',
        code: 'camera_resolution',
        node: camera.name,
        message: `Camera '${camera.name}' has no resolution, so it records 224 x 224 images.`,
        fix: `Set its resolution, for example apply_scene_operations set_attribute resolution [640, 480].`,
      });
    }
  }
  if (cameras.length) {
    const near = simulation.cameraClipping.near;
    for (const body of found.objects) {
      const point = vector(simulation.bodyPositions, body);
      const seen = cameras.some((camera) =>
        visibleFromCamera(
          point,
          vector(simulation.cameraPositions, camera.index),
          simulation.cameraRotations,
          camera.index * 9,
          fovys[camera.index],
          camera.resolution ? camera.resolution[0] / camera.resolution[1] : 1,
          near,
        ),
      );
      if (!seen) {
        const name = found.bodyName(body);
        issues.push({
          level: 'warning',
          code: 'not_visible',
          node: name,
          message: `No camera sees '${name}'.`,
          fix: `Aim a camera at '${name}' (check with render_camera), or move the object into view.`,
        });
      }
    }
  }

  return {
    ok: !issues.some((issue) => issue.level === 'error'),
    settleSeconds,
    robots: robots.map(({ name, reach, toolSite }) => ({ name, reach, toolSite })),
    objects,
    cameras: cameras.map(({ name, resolution }) => ({ name, resolution })),
    issues,
  };
}
