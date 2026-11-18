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
  | 'no_robot';

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
  objects: { name: string; moved: number; drop: number }[];
  cameras: { name: string; resolution: [number, number] | null }[];
  issues: SceneIssue[];
}

/** Resting contacts penetrate by well under a millimetre; authored overlaps are much deeper. */
export const OVERLAP_TOLERANCE = 0.005;
/** A drop larger than this means the object had nothing under it. */
export const FALL_DISTANCE = 0.05;
/** Movement above this while settling means it was resting badly (edge, tilt, slight float). */
export const SETTLE_DISTANCE = 0.01;

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
  }
  return { bodyName, objects, robots };
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

function overlapIssues(simulation: Simulation, objects: Inventory): SceneIssue[] {
  const model = simulation.model;
  const data = simulation.data;
  const geomBody = model.geom_bodyid as Int32Array;
  const rootOf = model.body_rootid as Int32Array;
  const geomNames = model.name_geomadr as Int32Array;
  const free = new Set(objects.objects);
  const deepest = new Map<string, { body: string; other: string; depth: number }>();
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
  return [...deepest.values()]
    .sort((a, b) => b.depth - a.depth)
    .map(({ body, other, depth }) => ({
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

export function checkScene(simulation: Simulation, settleSeconds = 1): SceneCheckResult {
  const model = simulation.model;
  const found = inventory(simulation);
  const issues: SceneIssue[] = [];
  simulation.forward();
  issues.push(...overlapIssues(simulation, found));

  const motion = settle(simulation, found.objects, settleSeconds);
  const objects = found.objects.map((body, index) => ({
    name: found.bodyName(body),
    moved: motion[index].moved,
    drop: motion[index].drop,
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
