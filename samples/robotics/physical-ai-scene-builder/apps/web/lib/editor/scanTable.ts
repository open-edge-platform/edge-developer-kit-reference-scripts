// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Simulation } from '@mujoco-studio/mujoco';
import { GeomType, JointType } from '@mujoco-studio/types';

import { isSplatTableName } from './document';

/** Geoms, bodies, and joints of a compiled model, as MuJoCo lays them out (row-major rotations). */
export interface TableGeometry {
  ngeom: number;
  geomBodyId: ArrayLike<number>;
  geomType: ArrayLike<number>;
  /** `geom_aabb`: local box center (3) then half sizes (3) per geom. */
  geomAabb: ArrayLike<number>;
  geomPositions: ArrayLike<number>;
  geomRotations: ArrayLike<number>;
  nbody: number;
  bodyParentId: ArrayLike<number>;
  bodyRootId: ArrayLike<number>;
  bodyJntAdr: ArrayLike<number>;
  bodyJntNum: ArrayLike<number>;
  jntType: ArrayLike<number>;
}

/** World-frame top, bottom, and XY footprint (axis-aligned bounds) of a splat table. */
export interface TableSurface {
  top: number;
  bottom: number;
  min: readonly [number, number];
  max: readonly [number, number];
}

/**
 * How far (m) the lowest point of a free object may be from the table top and still count as
 * resting on it. Resting contacts penetrate well under a millimetre; this also catches objects
 * dropped onto the table by hand.
 */
export const TABLE_RESTING_TOLERANCE = 0.01;
/** Deeper than this inside the table is an overlap; matches the Python `--check` tolerance. */
export const TABLE_OVERLAP_TOLERANCE = 0.005;

/** World-frame axis-aligned bounding box of one geom: center and half sizes. */
function geomWorldBox(geometry: TableGeometry, geom: number): { center: number[]; half: number[] } {
  const a = geom * 6;
  const local = [geometry.geomAabb[a], geometry.geomAabb[a + 1], geometry.geomAabb[a + 2]];
  const half = [geometry.geomAabb[a + 3], geometry.geomAabb[a + 4], geometry.geomAabb[a + 5]];
  const g = geom * 9;
  const rg = Array.from({ length: 9 }, (_, index) => geometry.geomRotations[g + index]);
  return {
    center: [0, 1, 2].map(
      (row) =>
        geometry.geomPositions[geom * 3 + row] +
        rg[row * 3] * local[0] +
        rg[row * 3 + 1] * local[1] +
        rg[row * 3 + 2] * local[2],
    ),
    half: [0, 1, 2].map(
      (row) =>
        Math.abs(rg[row * 3]) * half[0] +
        Math.abs(rg[row * 3 + 1]) * half[1] +
        Math.abs(rg[row * 3 + 2]) * half[2],
    ),
  };
}

/** World bounds of each worldbody-level free body (free joint, so its `pos` is world-frame). */
function freeBodyBounds(geometry: TableGeometry): Map<number, { min: number[]; max: number[] }> {
  const bounds = new Map<number, { min: number[]; max: number[] }>();
  for (let geom = 0; geom < geometry.ngeom; geom++) {
    const type = geometry.geomType[geom];
    if (type === GeomType.Plane || type === GeomType.HeightField) continue;
    const root = geometry.bodyRootId[geometry.geomBodyId[geom]];
    const isFree =
      root > 0 &&
      geometry.bodyParentId[root] === 0 &&
      geometry.bodyJntNum[root] > 0 &&
      geometry.jntType[geometry.bodyJntAdr[root]] === JointType.Free;
    if (!isFree) continue;
    const { center, half } = geomWorldBox(geometry, geom);
    const box = bounds.get(root) ?? {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
    };
    for (let axis = 0; axis < 3; axis++) {
      box.min[axis] = Math.min(box.min[axis], center[axis] - half[axis]);
      box.max[axis] = Math.max(box.max[axis], center[axis] + half[axis]);
    }
    bounds.set(root, box);
  }
  return bounds;
}

function overFootprint(box: { min: number[]; max: number[] }, table: TableSurface): boolean {
  return (
    box.min[0] <= table.max[0] &&
    box.max[0] >= table.min[0] &&
    box.min[1] <= table.max[1] &&
    box.max[1] >= table.min[1]
  );
}

/** Free bodies whose lowest point lies within `tolerance` of the table top, over its footprint. */
export function restingFreeBodies(
  geometry: TableGeometry,
  table: TableSurface,
  tolerance = TABLE_RESTING_TOLERANCE,
): number[] {
  return [...freeBodyBounds(geometry)]
    .filter(([, box]) => Math.abs(box.min[2] - table.top) <= tolerance && overFootprint(box, table))
    .map(([body]) => body)
    .sort((a, b) => a - b);
}

/**
 * Free bodies that start more than `tolerance` inside the table, deepest first. `depth` is how far
 * the body must rise for its lowest point to rest on the top.
 */
export function freeBodiesInsideTable(
  geometry: TableGeometry,
  table: TableSurface,
  tolerance = TABLE_OVERLAP_TOLERANCE,
): { body: number; depth: number }[] {
  return [...freeBodyBounds(geometry)]
    .filter(
      ([, box]) =>
        box.min[2] < table.top - tolerance &&
        box.max[2] > table.bottom &&
        overFootprint(box, table),
    )
    .map(([body, box]) => ({ body, depth: table.top - box.min[2] }))
    .sort((a, b) => b.depth - a.depth);
}

/** What the Splat panel and Inspector show about one splat table. */
export interface SplatTableStatus {
  /** Geom name (`scan_table`, `scan_table_2`, ...). */
  name: string;
  /** World height of the table top. */
  top: number;
  /** World XY center of the table. */
  center: readonly [number, number];
  /** Full width and depth of the box, in metres. */
  size: readonly [number, number];
  /** Rotation of the box about world z, in radians. */
  yaw: number;
  /** Free objects resting on the table (Match height carries them with its top). */
  resting: string[];
  /** Free objects that start inside the table, deepest first. */
  inside: { name: string; depth: number }[];
}

function tableGeometry(simulation: Simulation): TableGeometry {
  const model = simulation.model;
  return {
    ngeom: model.ngeom,
    geomBodyId: model.geom_bodyid as Int32Array,
    geomType: model.geom_type as Int32Array,
    geomAabb: model.geom_aabb as Float64Array,
    geomPositions: simulation.geomPositions,
    geomRotations: simulation.geomRotations,
    nbody: model.nbody,
    bodyParentId: model.body_parentid as Int32Array,
    bodyRootId: model.body_rootid as Int32Array,
    bodyJntAdr: model.body_jntadr as Int32Array,
    bodyJntNum: model.body_jntnum as Int32Array,
    jntType: model.jnt_type as Int32Array,
  };
}

/** The compiled splat tables (in name order) and the objects resting on or inside each. */
export function simulationSplatTables(simulation: Simulation | null): SplatTableStatus[] {
  if (!simulation) return [];
  const model = simulation.model;
  const geomNames = model.name_geomadr as Int32Array;
  const tables: { geom: number; name: string }[] = [];
  for (let geom = 0; geom < model.ngeom; geom++) {
    const name = simulation.nameAt(geomNames[geom]);
    if (isSplatTableName(name)) tables.push({ geom, name });
  }
  if (!tables.length) return [];
  const geometry = tableGeometry(simulation);
  const size = model.geom_size as Float64Array;
  const bodyNames = model.name_bodyadr as Int32Array;
  const bodyName = (body: number) => simulation.nameAt(bodyNames[body]) || `body_${body}`;
  return tables
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map(({ geom, name }) => {
      const { center, half } = geomWorldBox(geometry, geom);
      const table: TableSurface = {
        top: center[2] + half[2],
        bottom: center[2] - half[2],
        min: [center[0] - half[0], center[1] - half[1]],
        max: [center[0] + half[0], center[1] + half[1]],
      };
      const rotation = geom * 9;
      return {
        name,
        top: table.top,
        center: [center[0], center[1]] as const,
        size: [2 * size[geom * 3], 2 * size[geom * 3 + 1]] as const,
        yaw: Math.atan2(geometry.geomRotations[rotation + 3], geometry.geomRotations[rotation]),
        resting: restingFreeBodies(geometry, table).map(bodyName),
        inside: freeBodiesInsideTable(geometry, table).map(({ body, depth }) => ({
          name: bodyName(body),
          depth,
        })),
      };
    });
}

/** An object inside a splat table: how far it must rise to rest on that table's top. */
export interface TableOverlap {
  name: string;
  table: string;
  depth: number;
}

/** Objects inside any table, each with its deepest table, deepest first. */
export function objectsInsideTables(tables: readonly SplatTableStatus[]): TableOverlap[] {
  const deepest = new Map<string, TableOverlap>();
  for (const table of tables) {
    for (const { name, depth } of table.inside) {
      if (depth > (deepest.get(name)?.depth ?? -Infinity)) {
        deepest.set(name, { name, table: table.name, depth });
      }
    }
  }
  return [...deepest.values()].sort((a, b) => b.depth - a.depth);
}
