// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Simulation } from '@mujoco-studio/mujoco';
import { SPLAT_BACKDROP_BODY } from '@mujoco-studio/types';

/**
 * Geometry for MCP `place_object` and `set_object_physics`, read from the compiled MuJoCo model:
 * object bounding boxes, and the support under a footprint found with downward ray casts.
 */

export type Vec3 = [number, number, number];

/** Gap left between a placed object and its support, so it starts resting rather than inside. */
export const PLACEMENT_CLEARANCE = 0.001;
const PLANE = 0;

export interface BodyBox {
  body: number;
  /** Bounding box in the body's own frame. */
  low: Vec3;
  high: Vec3;
}

/** Body index by name, or -1 (Simulation.bodyIndex throws for a missing name). */
export function findBody(simulation: Simulation, name: string): number {
  try {
    return simulation.bodyIndex(name);
  } catch {
    return -1;
  }
}

function rootBody(simulation: Simulation, name: string): number {
  const index = findBody(simulation, name);
  const parent = simulation.model.body_parentid as Int32Array;
  if (index <= 0) throw new Error(`No body named "${name}". Read get_scene for body names.`);
  if (parent[index] !== 0) {
    throw new Error(`"${name}" is part of another body; place its top-level body instead.`);
  }
  if (name === SPLAT_BACKDROP_BODY) throw new Error('The splat backdrop cannot be moved.');
  return index;
}

/**
 * The geoms a body rests on. Objects rest on what collides (falling back to visual geometry);
 * robot instances (`<prefix>__root`) rest on all of it, because a robot's base frame sits at the
 * underside of its visible base while its collision shapes start higher (about 1.5 cm on the
 * SO-101), which would sink the base into the table.
 */
function geomsOf(simulation: Simulation, root: number, everything = false): number[] {
  const model = simulation.model;
  const rootOf = model.body_rootid as Int32Array;
  const geomBody = model.geom_bodyid as Int32Array;
  const type = model.geom_type as Int32Array;
  const contype = model.geom_contype as Int32Array;
  const conaffinity = model.geom_conaffinity as Int32Array;
  const all: number[] = [];
  const colliding: number[] = [];
  for (let geom = 0; geom < model.ngeom; geom++) {
    if (rootOf[geomBody[geom]] !== root || type[geom] === PLANE) continue;
    all.push(geom);
    if (contype[geom] !== 0 || conaffinity[geom] !== 0) colliding.push(geom);
  }
  if (everything) return all;
  // Rest on what collides; fall back to the visual geometry for objects without collision.
  return colliding.length ? colliding : all;
}

const MESH = 7;

/**
 * World-space points bounding a geom: a mesh's own vertices (its stored box follows the mesh's
 * inertia axes, which overstates odd shapes), otherwise the corners of its local bounding box.
 */
function geomCorners(simulation: Simulation, geom: number): Vec3[] {
  const model = simulation.model;
  const local: number[][] = [];
  const mesh = (model.geom_dataid as Int32Array)[geom];
  if ((model.geom_type as Int32Array)[geom] === MESH && mesh >= 0) {
    const vertices = model.mesh_vert as Float32Array;
    const start = (model.mesh_vertadr as Int32Array)[mesh];
    const count = (model.mesh_vertnum as Int32Array)[mesh];
    for (let vertex = start; vertex < start + count; vertex++) {
      local.push([vertices[vertex * 3], vertices[vertex * 3 + 1], vertices[vertex * 3 + 2]]);
    }
  } else {
    const aabb = model.geom_aabb as Float64Array;
    const center = [aabb[geom * 6], aabb[geom * 6 + 1], aabb[geom * 6 + 2]];
    const half = [aabb[geom * 6 + 3], aabb[geom * 6 + 4], aabb[geom * 6 + 5]];
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) {
          local.push([
            center[0] + sx * half[0],
            center[1] + sy * half[1],
            center[2] + sz * half[2],
          ]);
        }
  }
  const position = simulation.geomPositions;
  const rotation = simulation.geomRotations;
  return local.map((point) => {
    const world: Vec3 = [0, 0, 0];
    for (let row = 0; row < 3; row++) {
      world[row] =
        position[geom * 3 + row] +
        rotation[geom * 9 + row * 3] * point[0] +
        rotation[geom * 9 + row * 3 + 1] * point[1] +
        rotation[geom * 9 + row * 3 + 2] * point[2];
    }
    return world;
  });
}

/** The body's bounding box in its own frame, from the geoms it rests on (see geomsOf). */
export function bodyBox(simulation: Simulation, name: string): BodyBox {
  const body = rootBody(simulation, name);
  const geoms = geomsOf(simulation, body, name.endsWith('__root'));
  if (!geoms.length) throw new Error(`"${name}" has no geometry to place.`);
  const origin = bodyPosition(simulation, body);
  const rotation = bodyRotation(simulation, body);
  const low: Vec3 = [Infinity, Infinity, Infinity];
  const high: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const geom of geoms) {
    for (const corner of geomCorners(simulation, geom)) {
      const d = [corner[0] - origin[0], corner[1] - origin[1], corner[2] - origin[2]];
      for (let axis = 0; axis < 3; axis++) {
        // Body frame = R^T (world - origin); R is row-major.
        const value = rotation[axis] * d[0] + rotation[3 + axis] * d[1] + rotation[6 + axis] * d[2];
        low[axis] = Math.min(low[axis], value);
        high[axis] = Math.max(high[axis], value);
      }
    }
  }
  return { body, low, high };
}

export function bodyPosition(simulation: Simulation, body: number): Vec3 {
  const p = simulation.bodyPositions;
  return [p[body * 3], p[body * 3 + 1], p[body * 3 + 2]];
}

function bodyRotation(simulation: Simulation, body: number): Float64Array {
  return (simulation.data.xmat as Float64Array).subarray(body * 9, body * 9 + 9);
}

function rotationFromQuat([w, x, y, z]: readonly number[]): number[] {
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y),
  ];
}

/** World-space corners of a body-frame box placed at `position` with orientation `quat`. */
function placedCorners(box: BodyBox, position: Vec3, quat: readonly number[]): Vec3[] {
  const r = rotationFromQuat(quat);
  const corners: Vec3[] = [];
  for (const x of [box.low[0], box.high[0]])
    for (const y of [box.low[1], box.high[1]])
      for (const z of [box.low[2], box.high[2]]) {
        corners.push([
          position[0] + r[0] * x + r[1] * y + r[2] * z,
          position[1] + r[3] * x + r[4] * y + r[5] * z,
          position[2] + r[6] * x + r[7] * y + r[8] * z,
        ]);
      }
  return corners;
}

export function worldBounds(corners: readonly Vec3[]): { low: Vec3; high: Vec3 } {
  const low: Vec3 = [Infinity, Infinity, Infinity];
  const high: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const corner of corners) {
    for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis], corner[axis]);
      high[axis] = Math.max(high[axis], corner[axis]);
    }
  }
  return { low, high };
}

/** The body's current world bounding box (for surfaces and `beside` references). */
export function currentWorldBounds(simulation: Simulation, name: string) {
  const box = bodyBox(simulation, name);
  return worldBounds(
    placedCorners(box, bodyPosition(simulation, box.body), currentQuat(simulation, box.body)),
  );
}

/** World bounds of a surface: a top-level body, or a geom of the world body (a scan table). */
function surfaceBounds(
  simulation: Simulation,
  name: string,
): { low: Vec3; high: Vec3; root: number } {
  if (findBody(simulation, name) > 0)
    return { ...currentWorldBounds(simulation, name), root: findBody(simulation, name) };
  const geomNames = simulation.model.name_geomadr as Int32Array;
  const geomBody = simulation.model.geom_bodyid as Int32Array;
  for (let geom = 0; geom < simulation.model.ngeom; geom++) {
    if (geomBody[geom] === 0 && simulation.nameAt(geomNames[geom]) === name) {
      if ((simulation.model.geom_type as Int32Array)[geom] === PLANE) {
        throw new Error(`"${name}" is an infinite plane; use at with a world X, Y instead.`);
      }
      return { ...worldBounds(geomCorners(simulation, geom)), root: 0 };
    }
  }
  throw new Error(`No body or world geom named "${name}". Read get_scene for names.`);
}

export function currentQuat(
  simulation: Simulation,
  body: number,
): [number, number, number, number] {
  const q = simulation.data.xquat as Float64Array;
  return [q[body * 4], q[body * 4 + 1], q[body * 4 + 2], q[body * 4 + 3]];
}

export function yawQuat(degrees: number): [number, number, number, number] {
  const half = (degrees * Math.PI) / 360;
  return [Math.cos(half), 0, 0, Math.sin(half)];
}

interface Hit {
  z: number;
  support: string;
  root: number;
}

/**
 * The first surface straight below (x, y), skipping `exclude` and the splat backdrop: their
 * geoms are passed through by casting again from just below each skipped hit.
 */
function supportBelow(
  simulation: Simulation,
  x: number,
  y: number,
  top: number,
  exclude: number,
): Hit | null {
  const mujoco = simulation.mujoco as unknown as {
    mj_ray: (...args: unknown[]) => number;
    IntBuffer: new (size: number) => { GetView(): Int32Array; delete(): void };
  };
  const model = simulation.model;
  const rootOf = model.body_rootid as Int32Array;
  const geomBody = model.geom_bodyid as Int32Array;
  const contype = model.geom_contype as Int32Array;
  const conaffinity = model.geom_conaffinity as Int32Array;
  const geomNames = model.name_geomadr as Int32Array;
  const backdrop = findBody(simulation, SPLAT_BACKDROP_BODY);
  const hitGeom = new mujoco.IntBuffer(1);
  try {
    let z = top;
    for (let attempt = 0; attempt < 32; attempt++) {
      const distance = mujoco.mj_ray(
        model,
        simulation.data,
        [x, y, z],
        [0, 0, -1],
        null,
        true,
        exclude,
        hitGeom,
        null,
      );
      const geom = hitGeom.GetView()[0];
      if (distance < 0 || geom < 0) return null;
      const hitZ = z - distance;
      const root = rootOf[geomBody[geom]];
      const passThrough =
        root === exclude ||
        (backdrop >= 0 && root === backdrop) ||
        (contype[geom] === 0 && conaffinity[geom] === 0);
      if (!passThrough) {
        const support =
          root > 0
            ? simulation.nameAt((model.name_bodyadr as Int32Array)[root])
            : simulation.nameAt(geomNames[geom]) || 'the floor';
        return { z: hitZ, support, root };
      }
      z = hitZ - 1e-4;
    }
    return null;
  } finally {
    hitGeom.delete();
  }
}

export type PlacementTarget =
  | { kind: 'at'; x: number; y: number }
  | { kind: 'on'; surface: string; offset: [number, number] }
  | { kind: 'beside'; reference: string; direction: [number, number]; gap: number };

export interface PlacementPlan {
  object: string;
  position: Vec3;
  quat: [number, number, number, number];
  support: string;
  supportTop: number;
  footprint: { low: [number, number]; high: [number, number] };
}

/** Where to put `object` so it rests on the support under the target point. */
export function planPlacement(
  simulation: Simulation,
  object: string,
  target: PlacementTarget,
  yawDegrees?: number,
): PlacementPlan {
  const box = bodyBox(simulation, object);
  const quat = yawDegrees === undefined ? currentQuat(simulation, box.body) : yawQuat(yawDegrees);
  // Footprint of the object with its new orientation, around its origin.
  const relative = worldBounds(placedCorners(box, [0, 0, 0], quat));
  let x: number;
  let y: number;
  let surfaceRoot: number | null = null;
  if (target.kind === 'at') {
    ({ x, y } = target);
  } else if (target.kind === 'on') {
    const bounds = surfaceBounds(simulation, target.surface);
    surfaceRoot = bounds.root;
    x = (bounds.low[0] + bounds.high[0]) / 2 + target.offset[0];
    y = (bounds.low[1] + bounds.high[1]) / 2 + target.offset[1];
  } else {
    if (target.reference === object) throw new Error('An object cannot be placed beside itself.');
    const bounds = currentWorldBounds(simulation, target.reference);
    const [dx, dy] = target.direction;
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) throw new Error('beside.direction needs a nonzero X or Y component.');
    const ux = dx / length;
    const uy = dy / length;
    const center = [(bounds.low[0] + bounds.high[0]) / 2, (bounds.low[1] + bounds.high[1]) / 2];
    const referenceHalf =
      (Math.abs(ux) * (bounds.high[0] - bounds.low[0])) / 2 +
      (Math.abs(uy) * (bounds.high[1] - bounds.low[1])) / 2;
    // How far the object's footprint extends from its origin toward the reference (-u).
    const objectHalf = Math.max(
      ...[
        [relative.low[0], relative.low[1]],
        [relative.low[0], relative.high[1]],
        [relative.high[0], relative.low[1]],
        [relative.high[0], relative.high[1]],
      ].map(([cx, cy]) => -(ux * cx + uy * cy)),
    );
    const step = referenceHalf + objectHalf + target.gap;
    x = center[0] + ux * step;
    y = center[1] + uy * step;
  }
  const low: [number, number] = [x + relative.low[0], y + relative.low[1]];
  const high: [number, number] = [x + relative.high[0], y + relative.high[1]];
  // Rays from the centre and the (slightly inset) footprint corners; the highest hit supports it.
  const inset = 0.9;
  const points: [number, number][] = [[x, y]];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      points.push([
        x + (sx < 0 ? relative.low[0] : relative.high[0]) * inset,
        y + (sy < 0 ? relative.low[1] : relative.high[1]) * inset,
      ]);
    }
  const sceneTop =
    (simulation.model.stat.center as ArrayLike<number>)[2] + simulation.model.stat.extent + 1;
  let best: Hit | null = null;
  for (const [px, py] of points) {
    const hit = supportBelow(simulation, px, py, sceneTop, box.body);
    if (hit && (!best || hit.z > best.z)) best = hit;
  }
  if (!best) {
    throw new Error(
      `Nothing is under "${object}" at x=${x.toFixed(3)}, y=${y.toFixed(3)}. Add a table or floor there first.`,
    );
  }
  const onTarget =
    surfaceRoot === null ||
    (surfaceRoot > 0
      ? best.root === surfaceRoot
      : best.root === 0 && target.kind === 'on' && best.support === target.surface);
  if (!onTarget) {
    throw new Error(
      `"${best.support}" is in the way above "${target.kind === 'on' ? target.surface : ''}" at that spot. Choose an offset away from it.`,
    );
  }
  const z = best.z - relative.low[2] + PLACEMENT_CLEARANCE;
  return {
    object,
    position: [x, y, z],
    quat,
    support: best.support,
    supportTop: best.z,
    footprint: { low, high },
  };
}

/** Size of the object along its own axes, in meters. */
export function bodyDimensions(simulation: Simulation, name: string): Vec3 {
  const box = bodyBox(simulation, name);
  return [box.high[0] - box.low[0], box.high[1] - box.low[1], box.high[2] - box.low[2]];
}
