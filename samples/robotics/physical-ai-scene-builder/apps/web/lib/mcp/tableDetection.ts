// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Simulation } from '@mujoco-studio/mujoco';
import { SPLAT_BACKDROP_BODY } from '@mujoco-studio/types';

/**
 * MCP `detect_table`: flat support surfaces in a scanned room, found on the splat backdrop's
 * heightfield in the compiled model (the scan's points are not needed). The floor is the fullest
 * height band; tables are connected flat patches between `minHeight` and `maxHeight` above it,
 * fitted with a rotated rectangle.
 */

const HFIELD = 1;
const FREE_JOINT = 0;

export interface DetectTableOptions {
  /** Lowest table top above the floor, meters. */
  minHeight?: number;
  /** Highest table top above the floor, meters. */
  maxHeight?: number;
  /** Largest height step between neighbouring samples on one flat surface, meters. */
  flatTolerance?: number;
  /** Smallest top area worth proposing, square meters. */
  minArea?: number;
  /**
   * With a robot in the scene, only surface within this distance of its base is fitted, so a long
   * bench becomes the table the robot works on, meters. 0 fits whole surfaces.
   */
  workspaceRadius?: number;
}

export interface TableProposal {
  /** World X, Y of the top's centre. */
  center: [number, number];
  /** Full width and depth along the table's own axes, meters. */
  size: [number, number];
  /** Rotation of the width axis about world Z, degrees. */
  yaw: number;
  /** World height of the top. */
  top: number;
  /** Height above the detected floor. */
  height: number;
  /** Flat area found, square meters, and the share of the rectangle it fills. */
  area: number;
  fill: number;
  /** Spread of the top's heights (standard deviation), meters. */
  flatness: number;
  /** Horizontal distance from the nearest robot's base to the rectangle (0 when it is on it). */
  robotDistance: number | null;
}

export interface TableDetection {
  floor: number;
  /** Sample spacing of the scan's heightfield, meters. */
  resolution: number;
  tables: TableProposal[];
}

interface Grid {
  nrow: number;
  ncol: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  cell: number;
}

function backdropGrid(simulation: Simulation): Grid {
  const model = simulation.model;
  const bodyNames = model.name_bodyadr as Int32Array;
  let backdrop = -1;
  for (let body = 1; body < model.nbody; body++) {
    if (simulation.nameAt(bodyNames[body]) === SPLAT_BACKDROP_BODY) backdrop = body;
  }
  if (backdrop < 0) {
    throw new Error(
      'The scene has no scanned room (splat backdrop). Add one in Build > Splat first.',
    );
  }
  const geomBody = model.geom_bodyid as Int32Array;
  const geomType = model.geom_type as Int32Array;
  let geom = -1;
  for (let index = 0; index < model.ngeom; index++) {
    if (geomBody[index] === backdrop && geomType[index] === HFIELD) geom = index;
  }
  if (geom < 0)
    throw new Error('The scanned room has no heightfield; reload the splat in Build > Splat.');
  const field = (model.geom_dataid as Int32Array)[geom];
  const nrow = (model.hfield_nrow as Int32Array)[field];
  const ncol = (model.hfield_ncol as Int32Array)[field];
  const size = (model.hfield_size as Float64Array).subarray(field * 4, field * 4 + 4);
  const data = model.hfield_data as Float32Array;
  const start = (model.hfield_adr as Int32Array)[field];
  const position = simulation.geomPositions.subarray(geom * 3, geom * 3 + 3);
  const r = simulation.geomRotations.subarray(geom * 9, geom * 9 + 9);
  const x = new Float64Array(nrow * ncol);
  const y = new Float64Array(nrow * ncol);
  const z = new Float64Array(nrow * ncol);
  for (let row = 0; row < nrow; row++) {
    for (let col = 0; col < ncol; col++) {
      const index = row * ncol + col;
      // MuJoCo hfield vertex in the geom frame: X across columns, Y across rows (row 0 at -Y).
      const lx = ((2 * col) / (ncol - 1) - 1) * size[0];
      const ly = ((2 * row) / (nrow - 1) - 1) * size[1];
      const lz = data[start + index] * size[2];
      x[index] = position[0] + r[0] * lx + r[1] * ly + r[2] * lz;
      y[index] = position[1] + r[3] * lx + r[4] * ly + r[5] * lz;
      z[index] = position[2] + r[6] * lx + r[7] * ly + r[8] * lz;
    }
  }
  const cell = Math.min((2 * size[0]) / (ncol - 1), (2 * size[1]) / (nrow - 1));
  return { nrow, ncol, x, y, z, cell };
}

function quantile(sorted: Float64Array, share: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(share * (sorted.length - 1))))];
}

/** The floor: the fullest 1 cm height band (the floor covers more of a room than any table). */
function floorHeight(z: Float64Array): number {
  const bins = new Map<number, number[]>();
  let best = 0;
  let bestKey = 0;
  for (const value of z) {
    const key = Math.floor(value / 0.01);
    const bin = bins.get(key) ?? [];
    bin.push(value);
    bins.set(key, bin);
    if (bin.length > best) {
      best = bin.length;
      bestKey = key;
    }
  }
  const values = Float64Array.from(bins.get(bestKey) ?? [0]).sort();
  return quantile(values, 0.5);
}

/** Root bodies with at least two non-free joints: robot arms, by their first joint's position. */
function robotBases(simulation: Simulation): [number, number][] {
  const model = simulation.model;
  const rootOf = model.body_rootid as Int32Array;
  const jointBody = model.jnt_bodyid as Int32Array;
  const jointType = model.jnt_type as Int32Array;
  const first = new Map<number, { body: number; count: number }>();
  for (let joint = 0; joint < model.njnt; joint++) {
    if (jointType[joint] === FREE_JOINT) continue;
    const body = jointBody[joint];
    const root = rootOf[body];
    const entry = first.get(root) ?? { body, count: 0 };
    entry.count += 1;
    entry.body = Math.min(entry.body, body);
    first.set(root, entry);
  }
  const positions = simulation.bodyPositions;
  return [...first.values()]
    .filter((entry) => entry.count >= 2)
    .map(({ body }) => [positions[body * 3], positions[body * 3 + 1]]);
}

/**
 * The direction of a top's straight edges, folded to [0, 90) degrees: for each top sample next to
 * a drop (a neighbour more than `drop` lower within two samples), the direction to the lower
 * samples' centroid, histogrammed in 1 degree bins and smoothed over 5. Null with too few edges.
 */
function edgeYaw(grid: Grid, members: readonly number[], drop: number): number | null {
  const { nrow, ncol, x, y, z } = grid;
  const votes = new Float64Array(90);
  let total = 0;
  for (const index of members) {
    const row = Math.floor(index / ncol);
    const col = index % ncol;
    let sx = 0;
    let sy = 0;
    let lower = 0;
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || c < 0 || r >= nrow || c >= ncol) continue;
        const next = r * ncol + c;
        if (z[index] - z[next] < drop) continue;
        sx += x[next] - x[index];
        sy += y[next] - y[index];
        lower += 1;
      }
    }
    if (lower < 3) continue;
    const angle = ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 90;
    votes[Math.floor(angle) % 90] += 1;
    total += 1;
  }
  if (total < 8) return null;
  let best = 0;
  let bestScore = -1;
  for (let degree = 0; degree < 90; degree++) {
    let score = 0;
    for (let offset = -2; offset <= 2; offset++) score += votes[(degree + offset + 90) % 90];
    if (score > bestScore) {
      bestScore = score;
      best = degree;
    }
  }
  return best + 0.5;
}

function fitRectangle(
  points: [number, number][],
  yawDegrees: number | null = null,
): {
  center: [number, number];
  size: [number, number];
  yaw: number;
  axes: [[number, number], [number, number]];
} {
  const count = points.length;
  let mx = 0;
  let my = 0;
  for (const [px, py] of points) {
    mx += px / count;
    my += py / count;
  }
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [px, py] of points) {
    sxx += (px - mx) ** 2;
    sxy += (px - mx) * (py - my);
    syy += (py - my) ** 2;
  }
  // The table's edge direction when known, otherwise the patch's principal direction.
  const angle =
    yawDegrees === null ? 0.5 * Math.atan2(2 * sxy, sxx - syy) : (yawDegrees * Math.PI) / 180;
  const u: [number, number] = [Math.cos(angle), Math.sin(angle)];
  const v: [number, number] = [-u[1], u[0]];
  const along = Float64Array.from(
    points.map(([px, py]) => (px - mx) * u[0] + (py - my) * u[1]),
  ).sort();
  const across = Float64Array.from(
    points.map(([px, py]) => (px - mx) * v[0] + (py - my) * v[1]),
  ).sort();
  // Trim 1% at each edge so stray samples do not stretch the table.
  const a0 = quantile(along, 0.01);
  const a1 = quantile(along, 0.99);
  const b0 = quantile(across, 0.01);
  const b1 = quantile(across, 0.99);
  const ca = (a0 + a1) / 2;
  const cb = (b0 + b1) / 2;
  return {
    center: [mx + u[0] * ca + v[0] * cb, my + u[1] * ca + v[1] * cb],
    size: [a1 - a0, b1 - b0],
    yaw: (angle * 180) / Math.PI,
    axes: [u, v],
  };
}

/** Connected regions of `mask` (8-neighbour), joining cells up to `bridge` cells apart. */
function regionsOf(mask: Uint8Array, nrow: number, ncol: number, bridge: number): number[][] {
  // Close small gaps (objects or noise on a top) by labelling a dilated mask, then keep the
  // original cells of each dilated region.
  const dilated = new Uint8Array(mask.length);
  for (let index = 0; index < mask.length; index++) {
    if (!mask[index]) continue;
    const row = Math.floor(index / ncol);
    const col = index % ncol;
    for (let r = Math.max(0, row - bridge); r <= Math.min(nrow - 1, row + bridge); r++) {
      for (let c = Math.max(0, col - bridge); c <= Math.min(ncol - 1, col + bridge); c++) {
        dilated[r * ncol + c] = 1;
      }
    }
  }
  const label = new Int32Array(mask.length).fill(-1);
  const regions: number[][] = [];
  for (let seed = 0; seed < mask.length; seed++) {
    if (!dilated[seed] || label[seed] >= 0) continue;
    const members: number[] = [];
    const stack = [seed];
    label[seed] = regions.length;
    while (stack.length) {
      const index = stack.pop()!;
      if (mask[index]) members.push(index);
      const row = Math.floor(index / ncol);
      const col = index % ncol;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const r = row + dr;
          const c = col + dc;
          if ((!dr && !dc) || r < 0 || c < 0 || r >= nrow || c >= ncol) continue;
          const next = r * ncol + c;
          if (!dilated[next] || label[next] >= 0) continue;
          label[next] = regions.length;
          stack.push(next);
        }
      }
    }
    regions.push(members);
  }
  return regions;
}

export function detectTables(
  simulation: Simulation,
  options: DetectTableOptions = {},
): TableDetection {
  const minHeight = options.minHeight ?? 0.3;
  const maxHeight = options.maxHeight ?? 1.3;
  const tolerance = options.flatTolerance ?? 0.025;
  const minArea = options.minArea ?? 0.04;
  const workspaceRadius = options.workspaceRadius ?? 0.6;
  const grid = backdropGrid(simulation);
  const floor = floorHeight(grid.z);
  const { nrow, ncol, x, y, z, cell } = grid;
  const minCells = Math.max(4, Math.ceil(minArea / (cell * cell)));
  const bases = robotBases(simulation);
  // With a robot, the heights and patches come from the surface it can work on.
  const inWorkspace = (index: number) =>
    !bases.length ||
    workspaceRadius <= 0 ||
    bases.some(([bx, by]) => Math.hypot(x[index] - bx, y[index] - by) <= workspaceRadius);
  // Table tops are the common heights among samples in the table range: peaks of a 1 cm
  // histogram, smoothed over 3 cm. Each peak claims the unclaimed samples within the tolerance.
  const bin = 0.01;
  const counts = new Map<number, number>();
  for (let index = 0; index < z.length; index++) {
    const height = z[index] - floor;
    if (height < minHeight || height > maxHeight || !inWorkspace(index)) continue;
    const key = Math.floor(z[index] / bin);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const smooth = (key: number) =>
    (counts.get(key - 1) ?? 0) + (counts.get(key) ?? 0) + (counts.get(key + 1) ?? 0);
  // Strongest heights first; a bin within 2 cm of a stronger one is the same surface.
  const peaks: number[] = [];
  for (const key of [...counts.keys()].sort((a, b) => smooth(b) - smooth(a) || a - b)) {
    if (smooth(key) < minCells) break;
    if (peaks.every((peak) => Math.abs(peak - key) > 2)) peaks.push(key);
  }
  const claimed = new Uint8Array(z.length);
  const tables: TableProposal[] = [];
  for (const peak of peaks) {
    const level = (peak + 0.5) * bin;
    const band = new Uint8Array(z.length);
    for (let index = 0; index < z.length; index++) {
      if (!claimed[index] && inWorkspace(index) && Math.abs(z[index] - level) <= tolerance) {
        band[index] = 1;
      }
    }
    for (const members of regionsOf(band, nrow, ncol, 1)) {
      if (members.length < minCells) continue;
      for (const index of members) claimed[index] = 1;
      const heights = Float64Array.from(members.map((index) => z[index])).sort();
      const top = quantile(heights, 0.5);
      const area = members.length * cell * cell;
      const points = members.map((index): [number, number] => [x[index], y[index]]);
      const edge = edgeYaw(grid, members, Math.max(0.1, minHeight / 2));
      // Edges on a sample grid are staircases, so refine the edge direction within 6 degrees to
      // the tightest rectangle.
      const rectangle =
        edge === null
          ? fitRectangle(points)
          : Array.from({ length: 25 }, (_, step) =>
              fitRectangle(points, edge - 6 + step * 0.5),
            ).reduce((best, candidate) =>
              candidate.size[0] * candidate.size[1] < best.size[0] * best.size[1]
                ? candidate
                : best,
            );
      const fill = Math.min(1, area / Math.max(1e-9, rectangle.size[0] * rectangle.size[1]));
      const spread = Math.sqrt(
        members.reduce((sum, index) => sum + (z[index] - top) ** 2, 0) / members.length,
      );
      const [u, v] = rectangle.axes;
      const robotDistance = bases.length
        ? Math.min(
            ...bases.map(([bx, by]) => {
              const dx = bx - rectangle.center[0];
              const dy = by - rectangle.center[1];
              const a = Math.max(0, Math.abs(dx * u[0] + dy * u[1]) - rectangle.size[0] / 2);
              const b = Math.max(0, Math.abs(dx * v[0] + dy * v[1]) - rectangle.size[1] / 2);
              return Math.hypot(a, b);
            }),
          )
        : null;
      tables.push({
        center: rectangle.center,
        size: rectangle.size,
        yaw: rectangle.yaw,
        top,
        height: top - floor,
        area,
        fill,
        flatness: spread,
        robotDistance,
      });
    }
  }
  tables.sort((a, b) =>
    a.robotDistance !== null && b.robotDistance !== null && a.robotDistance !== b.robotDistance
      ? a.robotDistance - b.robotDistance
      : b.area - a.area,
  );
  return { floor, resolution: cell, tables: tables.slice(0, 5) };
}
