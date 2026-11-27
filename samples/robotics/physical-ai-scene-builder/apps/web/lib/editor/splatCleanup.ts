// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { SplatCleanupV1 } from '@mujoco-studio/types';

import { rotationMatrix, SPLAT_OPACITY_THRESHOLD, type QuaternionTuple } from './splatCollision';

/**
 * Splat cleanup: what of a scan the backdrop leaves out, stored with the splat calibration and
 * applied the same way by the browser renderer, the collision heightfield, and the native XPU
 * compositor (`robotic_studio/generation/backdrop.py` `cleanup_keep_mask`), so recordings keep
 * matching the preview.
 *
 * A Gaussian is removed when, in the backdrop body frame (`scale * R * p_raw`):
 * - `crop` is set and its centre lies outside the box, or
 * - its opacity is below `minOpacity`, or
 * - `isolation` is set, it is visible (opacity >= SPLAT_OPACITY_THRESHOLD), and fewer than
 *   `minNeighbors` other visible, kept Gaussians share its `cell`-sized voxel or the 26 around it.
 *   Fainter Gaussians are never tested for isolation; crop and opacity remove them.
 */
export type SplatCleanup = SplatCleanupV1;

export const DEFAULT_ISOLATION = { cell: 0.05, minNeighbors: 3 } as const;

/** True when the cleanup removes anything at all. */
export function cleanupActive(cleanup: SplatCleanup | null | undefined): cleanup is SplatCleanup {
  return Boolean(cleanup && (cleanup.crop || (cleanup.minOpacity ?? 0) > 0 || cleanup.isolation));
}

const finite3 = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

/** Validates a stored cleanup; invalid parts are dropped. */
export function normalizeSplatCleanup(value: unknown): SplatCleanup {
  const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const cleanup: SplatCleanup = {};
  const crop = candidate.crop as Record<string, unknown> | undefined;
  if (
    crop &&
    finite3(crop.min) &&
    finite3(crop.max) &&
    crop.min.every((low, axis) => low < (crop.max as number[])[axis])
  ) {
    cleanup.crop = { min: [...crop.min], max: [...crop.max] };
  }
  if (
    typeof candidate.minOpacity === 'number' &&
    candidate.minOpacity > 0 &&
    candidate.minOpacity <= 1
  ) {
    cleanup.minOpacity = candidate.minOpacity;
  }
  const isolation = candidate.isolation as Record<string, unknown> | undefined;
  if (
    isolation &&
    typeof isolation.cell === 'number' &&
    isolation.cell > 0 &&
    Number.isInteger(isolation.minNeighbors) &&
    (isolation.minNeighbors as number) >= 1
  ) {
    cleanup.isolation = { cell: isolation.cell, minNeighbors: isolation.minNeighbors as number };
  }
  return cleanup;
}

/** A raw-PLY to body-frame transform: `scale * R * p`. */
export function bodyTransform(scale: number, rotation: QuaternionTuple) {
  const r = rotationMatrix(rotation);
  const s = scale > 0 ? scale : 1;
  return (x: number, y: number, z: number): [number, number, number] => [
    s * (r[0] * x + r[1] * y + r[2] * z),
    s * (r[3] * x + r[4] * y + r[5] * z),
    s * (r[6] * x + r[7] * y + r[8] * z),
  ];
}

/** Crop and opacity test for one Gaussian (raw position), used for every splat Spark draws. */
export function keptByCropAndOpacity(
  cleanup: SplatCleanup,
  toBody: ReturnType<typeof bodyTransform>,
  x: number,
  y: number,
  z: number,
  opacity: number,
): boolean {
  if ((cleanup.minOpacity ?? 0) > 0 && opacity < (cleanup.minOpacity as number)) return false;
  if (!cleanup.crop) return true;
  const p = toBody(x, y, z);
  const { min, max } = cleanup.crop;
  return (
    p[0] >= min[0] &&
    p[0] <= max[0] &&
    p[1] >= min[1] &&
    p[1] <= max[1] &&
    p[2] >= min[2] &&
    p[2] <= max[2]
  );
}

/**
 * Source indices (`SplatPoint.index`) the cleanup removes from these visible points, which carry
 * raw positions and opacities exactly as read from the file.
 */
export function removedSplatIndices(
  points: readonly { index: number; x: number; y: number; z: number; opacity: number }[],
  cleanup: SplatCleanup,
  scale: number,
  rotation: QuaternionTuple,
): Set<number> {
  const removed = new Set<number>();
  if (!cleanupActive(cleanup)) return removed;
  const toBody = bodyTransform(scale, rotation);
  const candidates: { index: number; key: [number, number, number] }[] = [];
  const cell = cleanup.isolation?.cell ?? 1;
  for (const point of points) {
    if (!keptByCropAndOpacity(cleanup, toBody, point.x, point.y, point.z, point.opacity)) {
      removed.add(point.index);
    } else if (cleanup.isolation && point.opacity >= SPLAT_OPACITY_THRESHOLD) {
      const p = toBody(point.x, point.y, point.z);
      candidates.push({
        index: point.index,
        key: [Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell)],
      });
    }
  }
  if (!cleanup.isolation) return removed;
  // Voxel coordinates fit in 16 bits each for any scan under ~3 km at 5 cm; a 48-bit integer key.
  const counts = new Map<number, number>();
  const id = (x: number, y: number, z: number) =>
    ((x + 32768) * 65536 + (y + 32768)) * 65536 + (z + 32768);
  for (const { key } of candidates) {
    const at = id(key[0], key[1], key[2]);
    counts.set(at, (counts.get(at) ?? 0) + 1);
  }
  const { minNeighbors } = cleanup.isolation;
  for (const { index, key } of candidates) {
    let neighbors = -1; // itself
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          neighbors += counts.get(id(key[0] + dx, key[1] + dy, key[2] + dz)) ?? 0;
    if (neighbors < minNeighbors) removed.add(index);
  }
  return removed;
}

const cache = new WeakMap<object, { key: string; removed: Set<number> }>();

/** `removedSplatIndices`, remembered per points array and cleanup (heightfield, tables, ...). */
export function cachedRemovedSplatIndices(
  points: readonly { index: number; x: number; y: number; z: number; opacity: number }[],
  cleanup: SplatCleanup | undefined,
  scale: number,
  rotation: QuaternionTuple,
): Set<number> | null {
  if (!cleanupActive(cleanup)) return null;
  const key = JSON.stringify([cleanup, scale, rotation]);
  const hit = cache.get(points);
  if (hit?.key === key) return hit.removed;
  const removed = removedSplatIndices(points, cleanup, scale, rotation);
  cache.set(points, { key, removed });
  return removed;
}

/** A world box `[min, max]` as the backdrop body-frame crop that contains it (its corners' AABB). */
export function worldBoxToBodyCrop(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  pose: { position: ArrayLike<number>; rotation: ArrayLike<number> },
): NonNullable<SplatCleanup['crop']> {
  const { position: t, rotation: r } = pose;
  const low: [number, number, number] = [Infinity, Infinity, Infinity];
  const high: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const x of [min[0], max[0]])
    for (const y of [min[1], max[1]])
      for (const z of [min[2], max[2]]) {
        const d = [x - t[0], y - t[1], z - t[2]];
        for (let axis = 0; axis < 3; axis++) {
          // Body frame = R^T (world - origin); R is row-major body-to-world.
          const value = r[axis] * d[0] + r[3 + axis] * d[1] + r[6 + axis] * d[2];
          low[axis] = Math.min(low[axis], value);
          high[axis] = Math.max(high[axis], value);
        }
      }
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    min: low.map(round) as [number, number, number],
    max: high.map(round) as [number, number, number],
  };
}

/** Horizontal margin and headroom of the crop fitted to the tables, meters. */
export const TABLE_CROP_MARGIN = 0.8;
export const TABLE_CROP_HEADROOM = 1.0;

/**
 * A world box around the tables (or `around`, e.g. the robot base, without tables): the tables'
 * footprint plus `TABLE_CROP_MARGIN`, from just below the floor to `TABLE_CROP_HEADROOM` above
 * the highest top. Null when there is nothing to fit.
 */
export function cropAroundTables(
  tables: readonly {
    center: readonly [number, number];
    size: readonly [number, number];
    yaw: number;
    top: number;
  }[],
  floor: number,
  around: readonly [number, number] | null = null,
): { min: [number, number, number]; max: [number, number, number] } | null {
  const xs: number[] = [];
  const ys: number[] = [];
  let top = floor;
  for (const table of tables) {
    const [cx, cy] = table.center;
    const [hw, hd] = [table.size[0] / 2, table.size[1] / 2];
    const c = Math.cos(table.yaw);
    const s = Math.sin(table.yaw);
    for (const [u, v] of [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ]) {
      xs.push(cx + c * u - s * v);
      ys.push(cy + s * u + c * v);
    }
    top = Math.max(top, table.top);
  }
  if (!xs.length && around) {
    xs.push(around[0]);
    ys.push(around[1]);
  }
  if (!xs.length) return null;
  const margin = TABLE_CROP_MARGIN;
  return {
    min: [Math.min(...xs) - margin, Math.min(...ys) - margin, floor - 0.1],
    max: [Math.max(...xs) + margin, Math.max(...ys) + margin, top + TABLE_CROP_HEADROOM],
  };
}
