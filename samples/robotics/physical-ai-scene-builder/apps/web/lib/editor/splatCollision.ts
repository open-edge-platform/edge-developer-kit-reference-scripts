// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  cachedRemovedSplatIndices,
  normalizeSplatCleanup,
  type SplatCleanup,
} from './splatCleanup';

/**
 * Derives the splat backdrop's alignment origin and MuJoCo collision heightfield from a
 * Gaussian-splat point cloud, independent of any splat-rendering library (plain sampled points,
 * not a `@sparkjsdev/spark` `SplatMesh`), so it can be unit tested directly.
 *
 * Frames (shared with the Python runtime):
 * - `p_raw`: raw PLY / Spark-local splat centers. Spark applies no axis flip to PLY centers.
 * - Body frame of the static MJCF body `rs_backdrop`: `q = scale * R * p_raw`, where `R` is the
 *   calibration rotation (`calibrationRotation`, a unit quaternion `[w, x, y, z]`) that turns the
 *   scan's up axis into body +z. The splat render matrix is `bodyWorld * R * S(scale)`.
 * - World: `R_body * q + t_body`. On creation `t_body` is the alignment origin
 *   `[-cx, -cy, -floor + level]` (computed on rotated, scaled visible points) and `R_body` is
 *   identity.
 * The heightfield geom lives inside the body; its position is expressed in the body frame.
 */

/** Splats fainter than this are ignored for alignment and collision. */
export const SPLAT_OPACITY_THRESHOLD = 0.3;
/** A height band counts as the floor when it holds at least this fraction of the fullest band. */
const FLOOR_BAND_FRACTION = 0.25;
const GRID_CELL = 0.05;
/** Grid vertices per axis at most; large scans use coarser cells beyond this. */
const MAX_GRID_SAMPLES = 256;
/** Smallest heightfield footprint per axis; narrower scans are padded symmetrically. */
const MIN_EXTENT = 0.5;
/** Smallest elevation range so MuJoCo's hfield size stays positive for flat scans. */
const MIN_RANGE = 0.001;
/** Solid base below the lowest sample (MuJoCo hfield size[3]); must be positive. */
const BASE_THICKNESS = 0.1;
/**
 * A vertex height is the `ROBUST_RANK`-th highest point (at least; see below) of its 3x3
 * neighbourhood, so up to two isolated floaters do not raise a column.
 */
const ROBUST_RANK = 3;
/**
 * Vertex height: among the points of the vertex's 3x3 neighbourhood within one clearance of the
 * vertex's own highest point (above or below; when fewer than `ROBUST_RANK` points are that close,
 * everything up to one clearance above it), the point at this top fraction (at least the
 * `ROBUST_RANK`-th highest). A cell holds few Gaussian centers, so a per-cell order statistic sits
 * inside the surface's Gaussian layer; pooling the neighbourhood estimates the top of the layer the
 * cell itself reaches and is robust to single points changing cells. The upper limit keeps a taller
 * neighbour (a desk next to the floor) from growing into a cell that holds no point of it; the
 * lower limit keeps a lower neighbour (the floor next to a desk edge) from outvoting the few
 * tabletop points of an edge cell, so desk edges do not slope down into the floor.
 */
const NEIGHBOURHOOD_TOP_FRACTION = 0.05;
/**
 * Empty cells surrounded by sampled ones (at least half of their neighbours, spanning at most
 * `HOLE_FLATNESS` clearances) take the lowest of them, growing up to this many grid steps into a
 * hole; other empty cells rest on the local floor.
 */
const FILL_RADIUS = 3;
const HOLE_FLATNESS = 2;
/** A vertex this many neighbours (of 8) rise above by a clearance sits in a gap of a surface. */
const GAP_MIN_NEIGHBOURS = 5;
/** Radius (fraction of the scene length L) searched for floor samples around an empty cell. */
const LOCAL_FLOOR_FRACTION = 0.05;
const MAX_LOCAL_FLOOR_RADIUS = 16;
/** Fewer sampled floor vertices than this: the floor layer's median is the floor surface. */
const MIN_FLOOR_CELLS = 8;
/** A cell deeper than one band below the floor is a pit only with this many deep neighbours. */
const PIT_MIN_NEIGHBOURS = 3;

// Scale-aware thresholds. Gaussian-splat scans are often not metric (a scan trained from video is
// in arbitrary units), so every length threshold is `max(metric minimum, fraction * L)`, where L is
// the robust scene length: the diagonal of the 5th-95th percentile horizontal extent of the
// calibrated points. The fractions are chosen so a metric room or desk scan with L <= 5 m keeps the
// metric minimum (the values used before thresholds were scale-aware), while a scan in other units
// gets the same thresholds relative to its own size:
// - height band (floor histogram, auto-level inlier distance): max(0.02, 0.004 L)
// - clearance above the floor surface:                        max(0.05, 0.01 L)
// - elevation step within one flat surface:                    max(0.02, 0.004 L)
const METRIC_BAND = 0.02;
const BAND_FRACTION = 0.004;
const METRIC_CLEARANCE = 0.05;
const CLEARANCE_FRACTION = 0.01;
const METRIC_STEP = 0.02;
const STEP_FRACTION = 0.004;
/** Points sampled (by stride) to estimate the scene length. */
const SCENE_LENGTH_SAMPLES = 20_000;

// Automatic max height: a ceiling is a dense layer near the top of the scan, separated from what
// is below by a mostly empty gap, that overlaps most of the visible floor (a tabletop hides the
// floor under it, a ceiling does not).
/** Robust top of the scan when no ceiling is found (fraction of points kept). */
const AUTO_TOP_QUANTILE = 0.99;
/** Height histogram bins between the floor and the robust top (coarser for tall scans). */
const CEILING_BINS = 60;
/** The ceiling layer starts above this fraction of the robust top. */
const CEILING_MIN_HEIGHT_FRACTION = 0.5;
/** Layer bins hold at least this fraction of the layer's peak bin. */
const CEILING_LAYER_FRACTION = 0.3;
/** The ceiling layer holds at least this fraction of the points above the floor. */
const CEILING_MIN_POINTS = 0.02;
/** At most this fraction of the points above the floor lies above the ceiling layer. */
const CEILING_MAX_ABOVE = 0.05;
/** The gap below the ceiling spans at least this fraction of the floor-to-ceiling height. */
const CEILING_GAP_FRACTION = 0.15;
/** Gap bins average at most this fraction of the ceiling layer's peak bin. */
const CEILING_GAP_DENSITY = 0.2;
/** The ceiling covers at least this fraction of the occupied floor cells. */
const CEILING_FLOOR_COVERAGE = 0.5;
/** Occupancy grid resolution (cells along the scene length) for the coverage test. */
const COVERAGE_CELLS_PER_LENGTH = 20;

export type Vec3Tuple = readonly [number, number, number];

export function isFiniteVec3(value: unknown): value is Vec3Tuple {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}
/** Unit quaternion `[w, x, y, z]` (MuJoCo order). */
export type QuaternionTuple = readonly [number, number, number, number];

export interface SplatPoint {
  /** Index into the source splat cloud (PLY vertex or `SplatMesh.forEachSplat` index). */
  index: number;
  x: number;
  y: number;
  z: number;
  opacity: number;
  /** Gaussian standard deviations along its local axes (linear, not log); absent: a point. */
  sx?: number;
  sy?: number;
  sz?: number;
  /** Gaussian orientation, unit quaternion (w, x, y, z); absent: identity. */
  qw?: number;
  qx?: number;
  qy?: number;
  qz?: number;
}

/** Raw PLY axis that points up in the real scene; the calibration maps it to body +z. */
export const SPLAT_UP_AXES = ['+z', '-z', '+y', '-y', '+x', '-x'] as const;
export type SplatUpAxis = (typeof SPLAT_UP_AXES)[number];

export interface SplatCalibration {
  /** Uniform scale from raw PLY units to metres. */
  scale: number;
  /** Desired world-space height of the detected floor. */
  level: number;
  /** Raw PLY axis mapped to body +z. */
  upAxis: SplatUpAxis;
  /** Fine leveling in degrees about body X, applied after the up-axis mapping. */
  tiltX: number;
  /** Fine leveling in degrees about body Y, applied after `tiltX`. */
  tiltY: number;
  /** What of the scan is left out (crop box, faint and isolated Gaussians); see splatCleanup.ts. */
  cleanup: SplatCleanup;
}

export const DEFAULT_SPLAT_CALIBRATION: SplatCalibration = {
  scale: 1,
  level: 0,
  upAxis: '+z',
  tiltX: 0,
  tiltY: 0,
  cleanup: {},
};

/** Tuning of the backdrop heightfield; the editor always uses the defaults. */
export interface SplatHeightfieldOptions {
  /** Crop around the scan center in metres; zero means uncropped. */
  cropWidth?: number;
  cropDepth?: number;
  /**
   * Points higher than this above the floor (walls, ceiling, floaters) are ignored. `null` is
   * Auto: a detected ceiling layer is excluded, otherwise the top 1% of points.
   */
  maxHeight?: number | null;
  /**
   * Samples sit this many vertical standard deviations above each Gaussian center (each lift capped
   * at one height band), so heights follow the rendered surface (the top of the Gaussian layer)
   * rather than the centers inside it. 0 uses centers only.
   */
  splatSize?: number;
}

/** Default `SplatHeightfieldOptions.splatSize`, also used to measure table heights. */
const DEFAULT_SPLAT_SIZE = 1;

type NumericCalibrationKey = Exclude<keyof SplatCalibration, 'upAxis' | 'cleanup'>;

export function isSplatUpAxis(value: unknown): value is SplatUpAxis {
  return typeof value === 'string' && (SPLAT_UP_AXES as readonly string[]).includes(value);
}

/**
 * Fills missing or invalid calibration fields from `DEFAULT_SPLAT_CALIBRATION`. Fields of older
 * saved calibrations (crop, max height, splat size, collision mode) are dropped.
 */
export function normalizeSplatCalibration(value: unknown): SplatCalibration {
  const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const read = (key: NumericCalibrationKey, valid: (number: number) => boolean) => {
    const number = candidate[key];
    return typeof number === 'number' && Number.isFinite(number) && valid(number)
      ? number
      : DEFAULT_SPLAT_CALIBRATION[key];
  };
  return {
    scale: read('scale', (number) => number > 0),
    level: read('level', () => true),
    upAxis: isSplatUpAxis(candidate.upAxis) ? candidate.upAxis : DEFAULT_SPLAT_CALIBRATION.upAxis,
    tiltX: read('tiltX', () => true),
    tiltY: read('tiltY', () => true),
    cleanup: normalizeSplatCleanup(candidate.cleanup),
  };
}

const HALF = Math.SQRT1_2;
/** Proper rotations taking each raw up axis to +z. */
const UP_AXIS_ROTATION: Record<SplatUpAxis, QuaternionTuple> = {
  '+z': [1, 0, 0, 0],
  '-z': [0, 1, 0, 0], // 180° about X
  '+y': [HALF, HALF, 0, 0], // +90° about X
  '-y': [HALF, -HALF, 0, 0], // -90° about X
  '+x': [HALF, 0, -HALF, 0], // -90° about Y
  '-x': [HALF, 0, HALF, 0], // +90° about Y
};

/** Hamilton product `a ⊗ b`: rotating by the result applies `b` first, then `a`. */
function multiplyQuaternions(a: QuaternionTuple, b: QuaternionTuple): QuaternionTuple {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

function axisRotation(axis: 'x' | 'y' | 'z', degrees: number): QuaternionTuple {
  const half = ((Number.isFinite(degrees) ? degrees : 0) * Math.PI) / 360;
  const c = Math.cos(half);
  const s = Math.sin(half);
  return axis === 'x' ? [c, s, 0, 0] : axis === 'y' ? [c, 0, s, 0] : [c, 0, 0, s];
}

/**
 * Calibration rotation `R` as a unit quaternion `[w, x, y, z]` from raw PLY coordinates to the
 * backdrop body frame: `R = Ry(tiltY) * Rx(tiltX) * R_up`, where `R_up` maps `upAxis` to +z and
 * the tilts rotate about the fixed body X then Y axes. `w` is kept non-negative.
 */
export function calibrationRotation(
  calibration: Pick<SplatCalibration, 'upAxis' | 'tiltX' | 'tiltY'>,
): QuaternionTuple {
  const up = UP_AXIS_ROTATION[calibration.upAxis] ?? UP_AXIS_ROTATION['+z'];
  const q = multiplyQuaternions(
    axisRotation('y', calibration.tiltY),
    multiplyQuaternions(axisRotation('x', calibration.tiltX), up),
  );
  const norm = Math.hypot(...q);
  const sign = q[0] < 0 ? -1 : 1;
  return [(sign * q[0]) / norm, (sign * q[1]) / norm, (sign * q[2]) / norm, (sign * q[3]) / norm];
}

/** Fold body tilt into calibration while keeping the composed raw-splat-to-world rotation fixed. */
export function levelBackdropPose(
  bodyQuat: QuaternionTuple,
  calibration: SplatCalibration,
): { bodyQuat: QuaternionTuple; calibration: SplatCalibration } {
  const bodyMatrix = rotationMatrix(bodyQuat);
  if (Math.abs(bodyMatrix[2]) < 1e-6 && Math.abs(bodyMatrix[5]) < 1e-6 && bodyMatrix[8] > 0) {
    return { bodyQuat, calibration };
  }

  const composed = multiplyQuaternions(bodyQuat, calibrationRotation(calibration));
  const nextCalibration = leveledCalibration(calibration, {
    x: bodyMatrix[6],
    y: bodyMatrix[7],
    z: bodyMatrix[8],
  });
  const nextRotation = calibrationRotation(nextCalibration);
  const inverseRotation: QuaternionTuple = [
    nextRotation[0],
    -nextRotation[1],
    -nextRotation[2],
    -nextRotation[3],
  ];
  const yawQuat = multiplyQuaternions(composed, inverseRotation);
  const yaw = (2 * Math.atan2(yawQuat[3], yawQuat[0]) * 180) / Math.PI;

  return {
    bodyQuat: axisRotation('z', yaw),
    calibration: nextCalibration,
  };
}

/** Row-major 3x3 rotation matrix of a unit quaternion `[w, x, y, z]`. */
export function rotationMatrix([w, x, y, z]: QuaternionTuple): number[] {
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - w * z),
    2 * (x * z + w * y),
    2 * (x * y + w * z),
    1 - 2 * (x * x + z * z),
    2 * (y * z - w * x),
    2 * (x * z - w * y),
    2 * (y * z + w * x),
    1 - 2 * (x * x + y * y),
  ];
}

export interface SplatHeightfield {
  nrow: number;
  ncol: number;
  /**
   * Row-major normalized heights in [0, 1] in mjModel order: row 0 is the -y edge, column 0 the
   * -x edge. The MJCF `elevation` attribute lists rows top (+y) first, so it is emitted reversed.
   * The minimum sample is exactly 0 and the maximum exactly 1 (or all 0 for a flat field), so
   * MuJoCo's own min/max normalization leaves the data unchanged.
   */
  data: readonly number[];
  /** MuJoCo hfield size: [x half-extent, y half-extent, elevation range, base thickness]. */
  size: readonly [number, number, number, number];
  /** Geom position in the backdrop body frame; z is the lowest sample (normalized 0). */
  position: Vec3Tuple;
}

export interface SplatBackdrop {
  /** Initial body position: `[-cx, -cy, -floor + level]` on rotated, scaled visible points. */
  origin: Vec3Tuple;
  heightfield: SplatHeightfield;
  /**
   * Floor surface height in the body frame: the median sampled heightfield vertex of the floor
   * layer, so the collision floor (and the rendered floor it follows) sits exactly at `floorZ`.
   */
  floorZ: number;
  /** Collision height limit above the floor layer that was applied (explicit or automatic). */
  maxHeight: number;
  /** Whether the automatic max height found and excluded a ceiling layer. */
  ceilingDetected: boolean;
  /** Scale-aware thresholds used for this scan. */
  metrics: SplatSceneMetrics;
}

/** Scale-aware length thresholds of one scan, in body-frame units (see the formulas above). */
export interface SplatSceneMetrics {
  /** Robust scene length L: diagonal of the 5th-95th percentile horizontal extent. */
  length: number;
  /** Height band for the floor histogram and the auto-level inlier distance. */
  band: number;
  /** Height above the floor surface before a vertex stops counting as floor. */
  clearance: number;
  /** Largest elevation step within one flat surface (a measured tabletop). */
  step: number;
}

interface Point {
  x: number;
  y: number;
  z: number;
}

/**
 * Vertical standard deviation of a Gaussian in the body frame, given the body-frame z row `mz` of
 * `scale * R`: the covariance is `M Rq S^2 Rq^T M^T`, so `sigma_z = |mz Rq S|`.
 */
function verticalSigma(point: SplatPoint, mz: readonly number[]): number {
  const sx = point.sx ?? 0;
  const sy = point.sy ?? 0;
  const sz = point.sz ?? 0;
  if (!(sx > 0 || sy > 0 || sz > 0)) return 0;
  const q = rotationMatrix([point.qw ?? 1, point.qx ?? 0, point.qy ?? 0, point.qz ?? 0]);
  // Row vector mz times the columns of Rq, each scaled by that axis' standard deviation.
  const a = (mz[0] * q[0] + mz[1] * q[3] + mz[2] * q[6]) * sx;
  const b = (mz[0] * q[1] + mz[1] * q[4] + mz[2] * q[7]) * sy;
  const c = (mz[0] * q[2] + mz[1] * q[5] + mz[2] * q[8]) * sz;
  const sigma = Math.hypot(a, b, c);
  return Number.isFinite(sigma) ? sigma : 0;
}

/**
 * Visible points in the backdrop body frame (`q = scale * R * p_raw`). When `sigmas` is given, it
 * receives each kept point's body-frame vertical standard deviation (`verticalSigma`).
 */
function bodyFramePoints(
  points: readonly SplatPoint[],
  calibration: SplatCalibration,
  sigmas?: number[],
): Point[] {
  const factor =
    calibration.scale > 0 && Number.isFinite(calibration.scale) ? calibration.scale : 1;
  const m = rotationMatrix(calibrationRotation(calibration)).map((value) => value * factor);
  const mz = [m[6], m[7], m[8]];
  const removed = cachedRemovedSplatIndices(
    points,
    calibration.cleanup,
    factor,
    calibrationRotation(calibration),
  );
  const result: Point[] = [];
  for (const point of points) {
    if (point.opacity < SPLAT_OPACITY_THRESHOLD) continue;
    if (removed?.has(point.index)) continue;
    const { x, y, z } = point;
    result.push({
      x: m[0] * x + m[1] * y + m[2] * z,
      y: m[3] * x + m[4] * y + m[5] * z,
      z: m[6] * x + m[7] * y + m[8] * z,
    });
    sigmas?.push(verticalSigma(point, mz));
  }
  return result;
}

/**
 * Raises each point by `splatSize` vertical standard deviations, each standard deviation capped at
 * one height band so a few huge, blurry Gaussians (floaters, reflections) cannot lift a surface.
 */
function liftBySplatSize(
  points: Point[],
  sigmas: readonly number[],
  splatSize: number,
  band: number,
): Point[] {
  if (!(splatSize > 0)) return points;
  return points.map((point, index) => ({
    x: point.x,
    y: point.y,
    z: point.z + splatSize * Math.min(sigmas[index] ?? 0, band),
  }));
}

function stride<T>(items: readonly T[], limit: number): T[] {
  if (items.length <= limit) return [...items];
  const step = items.length / limit;
  return Array.from({ length: limit }, (_, index) => items[Math.floor(index * step)]);
}

function quantile(sorted: ArrayLike<number>, fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * sorted.length)))];
}

/** Scale-aware thresholds from the robust horizontal extent of body-frame points. */
function sceneMetrics(points: readonly Point[]): SplatSceneMetrics {
  const sample = stride(points, SCENE_LENGTH_SAMPLES);
  let length = 0;
  if (sample.length) {
    const xs = Float64Array.from(sample, (point) => point.x).sort();
    const ys = Float64Array.from(sample, (point) => point.y).sort();
    length = Math.hypot(
      quantile(xs, 0.95) - quantile(xs, 0.05),
      quantile(ys, 0.95) - quantile(ys, 0.05),
    );
  }
  return {
    length,
    band: Math.max(METRIC_BAND, BAND_FRACTION * length),
    clearance: Math.max(METRIC_CLEARANCE, CLEARANCE_FRACTION * length),
    step: Math.max(METRIC_STEP, STEP_FRACTION * length),
  };
}

/**
 * Floor surface height. A histogram of heights in `band`-wide bands finds the floor layer: the
 * lowest band holding at least `FLOOR_BAND_FRACTION` of the fullest band (the fullest band alone
 * can be a densely scanned tabletop; a sparse floor still clears the fraction, while thin floaters
 * below it do not), extended upward over adjacent qualifying bands up to `maxThickness`. A real
 * floor is a layer of Gaussians several bands thick, so its surface is the median height of the
 * layer's points rather than the bottom of its lowest band.
 */
function floorSurface(points: readonly Point[], band: number, maxThickness: number): number | null {
  const buckets = new Map<number, number>();
  let maxCount = 0;
  for (const point of points) {
    const key = Math.floor(point.z / band);
    const count = (buckets.get(key) ?? 0) + 1;
    buckets.set(key, count);
    maxCount = Math.max(maxCount, count);
  }
  const threshold = maxCount * FLOOR_BAND_FRACTION;
  let floorKey: number | null = null;
  for (const [key, count] of buckets) {
    if (count >= threshold && (floorKey === null || key < floorKey)) floorKey = key;
  }
  if (floorKey === null) return null;
  let topKey = floorKey;
  while (
    (topKey + 2 - floorKey) * band <= maxThickness &&
    (buckets.get(topKey + 1) ?? 0) >= threshold
  ) {
    topKey++;
  }
  const layer: number[] = [];
  for (const point of points) {
    const key = Math.floor(point.z / band);
    if (key >= floorKey && key <= topKey) layer.push(point.z);
  }
  const sorted = Float64Array.from(layer).sort();
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function meanXY(points: readonly { x: number; y: number }[]): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const point of points) {
    sx += point.x;
    sy += point.y;
  }
  return points.length ? { x: sx / points.length, y: sy / points.length } : { x: 0, y: 0 };
}

/** Occupied cells of a coarse XY grid, keyed by cell. */
function occupiedCells(points: readonly Point[], cell: number): Set<number> {
  const cells = new Set<number>();
  for (const point of points) {
    cells.add(Math.floor(point.x / cell) * 1_000_003 + Math.floor(point.y / cell));
  }
  return cells;
}

/**
 * Automatic collision height limit above `floorZ`. Builds a histogram of heights above the floor
 * (up to the 99th percentile) and looks for a ceiling: the fullest bin in the upper half, grown
 * into a layer of adjacent dense bins, that
 * - holds at least `CEILING_MIN_POINTS` of the points and has at most `CEILING_MAX_ABOVE` above it,
 * - sits on a mostly empty gap (walls only) spanning `CEILING_GAP_FRACTION` of its height, and
 * - covers at least `CEILING_FLOOR_COVERAGE` of the occupied floor cells (a tabletop hides the
 *   floor under it; a ceiling spans the room).
 * The limit is then just below the ceiling layer; without a ceiling it is the 99th percentile, so
 * only the topmost floaters are dropped.
 */
function autoMaxHeight(
  points: readonly Point[],
  floorZ: number,
  metrics: SplatSceneMetrics,
): { height: number; ceiling: boolean } {
  const heights = Float64Array.from(
    points.filter((point) => point.z >= floorZ),
    (point) => point.z - floorZ,
  ).sort();
  const total = heights.length;
  const top = total ? quantile(heights, AUTO_TOP_QUANTILE) : 0;
  const none = { height: Math.max(top, metrics.band), ceiling: false };
  if (!(top > 0)) return none;
  const bin = Math.max(2 * metrics.band, top / CEILING_BINS);
  const bins = Math.floor(top / bin) + 1;
  const counts = new Uint32Array(bins);
  for (const height of heights) {
    if (height > top) break;
    counts[Math.min(bins - 1, Math.floor(height / bin))]++;
  }
  const first = Math.max(1, Math.ceil((CEILING_MIN_HEIGHT_FRACTION * top) / bin));
  let peak = -1;
  for (let index = first; index < bins; index++) {
    if (peak < 0 || counts[index] > counts[peak]) peak = index;
  }
  if (peak < 0 || counts[peak] === 0) return none;
  const dense = counts[peak] * CEILING_LAYER_FRACTION;
  let bottom = peak;
  while (bottom - 1 >= first && counts[bottom - 1] >= dense) bottom--;
  let upper = peak;
  while (upper + 1 < bins && counts[upper + 1] >= dense) upper++;
  let layerCount = 0;
  for (let index = bottom; index <= upper; index++) layerCount += counts[index];
  const layerHigh = (upper + 1) * bin;
  let below = 0;
  while (below < total && heights[below] < layerHigh) below++;
  if (layerCount < CEILING_MIN_POINTS * total) return none;
  if (total - below > CEILING_MAX_ABOVE * total) return none;
  const gapBins = Math.max(2, Math.ceil(CEILING_GAP_FRACTION * bottom));
  if (bottom - gapBins < 1) return none;
  let gapCount = 0;
  for (let index = bottom - gapBins; index < bottom; index++) gapCount += counts[index];
  if (gapCount / gapBins > CEILING_GAP_DENSITY * counts[peak]) return none;

  const layerLow = bottom * bin;
  const cell = metrics.length / COVERAGE_CELLS_PER_LENGTH;
  if (cell > 0) {
    const floorCells = occupiedCells(
      points.filter((point) => Math.abs(point.z - floorZ) <= metrics.clearance),
      cell,
    );
    const ceilingCells = occupiedCells(
      points.filter((point) => point.z - floorZ >= layerLow && point.z - floorZ < layerHigh),
      cell,
    );
    let covered = 0;
    for (const key of floorCells) if (ceilingCells.has(key)) covered++;
    if (!floorCells.size || covered < CEILING_FLOOR_COVERAGE * floorCells.size) return none;
  }
  return { height: Math.max(metrics.band, layerLow - metrics.band), ceiling: true };
}

/**
 * Derives the backdrop alignment origin and its (non-colliding) heightfield from raw splat points
 * and a calibration. Every output except `origin` is in the backdrop body frame.
 */
export function deriveSplatBackdrop(
  points: readonly SplatPoint[],
  calibration: SplatCalibration,
  options: SplatHeightfieldOptions = {},
): SplatBackdrop {
  const sigmas: number[] = [];
  const centers = bodyFramePoints(points, calibration, sigmas);
  // Lifting changes heights only, so the horizontal scene metrics are the same before and after.
  const metrics = sceneMetrics(centers);
  const body = liftBySplatSize(
    centers,
    sigmas,
    options.splatSize ?? DEFAULT_SPLAT_SIZE,
    metrics.band,
  );
  if (!body.length) {
    return {
      origin: [0, 0, calibration.level],
      heightfield: buildHeightGrid([], 0, { x: 0, y: 0 }, metrics).heightfield,
      floorZ: 0,
      maxHeight: 0,
      ceilingDetected: false,
      metrics,
    };
  }
  const center = meanXY(body);
  const layerZ = floorSurface(body, metrics.band, 2 * metrics.clearance) ?? 0;
  const cropWidth = options.cropWidth && options.cropWidth > 0 ? options.cropWidth : Infinity;
  const cropDepth = options.cropDepth && options.cropDepth > 0 ? options.cropDepth : Infinity;
  const cropped = body.filter(
    (point) =>
      Math.abs(point.x - center.x) <= cropWidth / 2 &&
      Math.abs(point.y - center.y) <= cropDepth / 2,
  );
  const explicit = options.maxHeight && options.maxHeight > 0 ? options.maxHeight : null;
  const auto = explicit === null ? autoMaxHeight(cropped, layerZ, metrics) : null;
  const maxHeight = explicit ?? auto!.height;
  const collision = cropped.filter((point) => point.z <= layerZ + maxHeight);
  const { heightfield, floorZ } = buildHeightGrid(collision, layerZ, center, metrics);
  const origin: Vec3Tuple = [-center.x, -center.y, -floorZ + calibration.level];
  return {
    origin,
    heightfield,
    floorZ,
    maxHeight,
    ceilingDetected: auto?.ceiling ?? false,
    metrics,
  };
}

/** Axis sample positions: true bounds, padded symmetrically to `MIN_EXTENT`. */
function axisExtent(min: number, max: number, fallback: number): { min: number; width: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: fallback - MIN_EXTENT / 2, width: MIN_EXTENT };
  }
  const width = max - min;
  if (width >= MIN_EXTENT) return { min, width };
  const middle = (min + max) / 2;
  return { min: middle - MIN_EXTENT / 2, width: MIN_EXTENT };
}

function sampleCount(width: number): number {
  return Math.min(MAX_GRID_SAMPLES, Math.max(2, Math.ceil(width / GRID_CELL) + 1));
}

interface HeightGrid {
  heightfield: SplatHeightfield;
  /** Floor surface: median sampled vertex height of the floor layer. */
  floorZ: number;
}

/** Indices of the up to 8 neighbours of `cell` in a row-major `nrow` x `ncol` grid. */
function neighbours8(cell: number, nrow: number, ncol: number): number[] {
  const row = Math.floor(cell / ncol);
  const col = cell % ncol;
  const result: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < nrow && c >= 0 && c < ncol) result.push(r * ncol + c);
    }
  }
  return result;
}

/**
 * Samples a robust height per grid vertex holding at least one point (the top
 * `NEIGHBOURHOOD_TOP_FRACTION` of its neighbourhood within one clearance of its own highest
 * point; vertices whose pool is smaller than `ROBUST_RANK` stay unsampled), then:
 * - Floor surface: the median of the sampled vertices within one clearance of the floor layer's
 *   median `layerZ`. A vertex height is the top of its Gaussians, so the sampled floor (like the
 *   rendered one) sits a little above the median of the floor layer's points; empty vertices rest
 *   on this surface instead of forming a sunken checkerboard below the sampled floor.
 * - Pits: a vertex more than one band below the floor surface is a real depression only when it
 *   holds `ROBUST_RANK` points of its own and at least `PIT_MIN_NEIGHBOURS` of its 8 neighbours
 *   are deep too (repeated until stable); otherwise (floaters or reflections under the floor) it
 *   is treated as unsampled.
 * - Holes: an unsampled vertex with at least half of its neighbours known, all within
 *   `HOLE_FLATNESS` clearances of each other, takes the lowest of them, growing up to `FILL_RADIUS`
 *   steps into a hole, so gaps in a tabletop do not drop to the floor while edges and clutter do
 *   not grow.
 * - Empty floor: every other unsampled vertex takes the median of the floor-level vertices (within
 *   one clearance of the floor surface) around it, up to `LOCAL_FLOOR_FRACTION` of the scene length
 *   away, else the floor surface. 3DGS covers a plain floor with few large Gaussians, so most floor
 *   vertices are empty; following the local floor keeps them level with the sampled ones.
 * - Gaps: a vertex at least one clearance below `GAP_MIN_NEIGHBOURS` agreeing neighbours takes the
 *   lowest of them (a tabletop with the floor showing through between large Gaussians).
 * Filled vertices never go below the pit limit (one band under the floor surface). Finally flat
 * regions are median-filtered over 3x3 vertices.
 */
function buildHeightGrid(
  points: readonly Point[],
  layerZ: number,
  fallbackCenter: { x: number; y: number },
  metrics: SplatSceneMetrics,
): HeightGrid {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const xAxis = axisExtent(minX, maxX, fallbackCenter.x);
  const yAxis = axisExtent(minY, maxY, fallbackCenter.y);
  const ncol = sampleCount(xAxis.width);
  const nrow = sampleCount(yAxis.width);
  const cells = nrow * ncol;
  // Heights binned per vertex: vertex `cell` owns heights[start[cell]..start[cell + 1]), ascending.
  const cellOf = new Int32Array(points.length);
  const counts = new Uint32Array(cells);
  points.forEach((point, index) => {
    const col = Math.min(
      ncol - 1,
      Math.max(0, Math.round(((point.x - xAxis.min) / xAxis.width) * (ncol - 1))),
    );
    const row = Math.min(
      nrow - 1,
      Math.max(0, Math.round(((point.y - yAxis.min) / yAxis.width) * (nrow - 1))),
    );
    cellOf[index] = row * ncol + col;
    counts[row * ncol + col]++;
  });
  const start = new Uint32Array(cells + 1);
  for (let cell = 0; cell < cells; cell++) start[cell + 1] = start[cell] + counts[cell];
  const heights = new Float64Array(points.length);
  const cursor = start.slice(0, cells);
  points.forEach((point, index) => {
    heights[cursor[cellOf[index]]++] = point.z;
  });
  for (let cell = 0; cell < cells; cell++) heights.subarray(start[cell], start[cell + 1]).sort();
  /** End of the run of heights <= limit in vertex `cell` (binary search). */
  const upperBound = (cell: number, limit: number) => {
    let low = start[cell];
    let high = start[cell + 1];
    while (low < high) {
      const middle = (low + high) >> 1;
      if (heights[middle] <= limit) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  /** Start of the run of heights >= limit in vertex `cell` (binary search). */
  const lowerBound = (cell: number, limit: number) => {
    let low = start[cell];
    let high = start[cell + 1];
    while (low < high) {
      const middle = (low + high) >> 1;
      if (heights[middle] < limit) low = middle + 1;
      else high = middle;
    }
    return low;
  };

  const values = new Float64Array(cells);
  const sampled = new Uint8Array(cells);
  const floorSamples: number[] = [];
  for (let cell = 0; cell < cells; cell++) {
    if (!counts[cell]) continue;
    const highest = heights[start[cell + 1] - 1];
    const block = [cell, ...neighbours8(cell, nrow, ncol)];
    const ends = block.map((next) => upperBound(next, highest + metrics.clearance));
    let begins = block.map((next) => lowerBound(next, highest - metrics.clearance));
    let poolSize = 0;
    block.forEach((_, index) => (poolSize += ends[index] - begins[index]));
    if (poolSize < ROBUST_RANK) {
      // Too few points near the cell's top (a floater, a sparse vertical structure): pool the
      // whole neighbourhood below the upper limit, so its robust rank decides.
      begins = block.map((next) => start[next]);
      poolSize = 0;
      block.forEach((_, index) => (poolSize += ends[index] - begins[index]));
    }
    const rank = Math.max(ROBUST_RANK, Math.ceil(NEIGHBOURHOOD_TOP_FRACTION * poolSize));
    if (poolSize < rank) continue;
    const top: number[] = [];
    block.forEach((_, index) => {
      for (let at = Math.max(begins[index], ends[index] - rank); at < ends[index]; at++) {
        top.push(heights[at]);
      }
    });
    top.sort((first, second) => second - first);
    const value = top[rank - 1];
    values[cell] = value;
    sampled[cell] = 1;
    if (Math.abs(value - layerZ) <= metrics.clearance) floorSamples.push(value);
  }
  let floorZ = layerZ;
  if (floorSamples.length >= MIN_FLOOR_CELLS) {
    const sorted = Float64Array.from(floorSamples).sort();
    floorZ = sorted[sorted.length >> 1];
  }
  for (let cell = 0; cell < cells; cell++) if (!sampled[cell]) values[cell] = floorZ;

  const pitLimit = floorZ - metrics.band;
  // A vertex below the floor needs `ROBUST_RANK` points of its own: sparse Gaussians under a floor
  // (reflections of a glossy floor) must not add up to a pit through the neighbourhood pool.
  for (let cell = 0; cell < cells; cell++) {
    if (sampled[cell] && values[cell] < pitLimit && counts[cell] < ROBUST_RANK) {
      sampled[cell] = 0;
      values[cell] = floorZ;
    }
  }
  const deep = (cell: number) => sampled[cell] === 1 && values[cell] < pitLimit;
  // Repeat until stable: clearing part of a small cluster can leave the rest isolated.
  for (let changed = true; changed;) {
    const isolated: number[] = [];
    for (let cell = 0; cell < cells; cell++) {
      if (!deep(cell)) continue;
      const deepNeighbours = neighbours8(cell, nrow, ncol).filter(deep).length;
      if (deepNeighbours < PIT_MIN_NEIGHBOURS) isolated.push(cell);
    }
    for (const cell of isolated) {
      sampled[cell] = 0;
      values[cell] = floorZ;
    }
    changed = isolated.length > 0;
  }

  const lowerMedian = (items: number[]) => {
    items.sort((first, second) => first - second);
    return items[(items.length - 1) >> 1];
  };
  const known = Uint8Array.from(sampled);
  for (let pass = 0; pass < FILL_RADIUS; pass++) {
    const updates: [number, number][] = [];
    for (let cell = 0; cell < cells; cell++) {
      if (known[cell]) continue;
      const around = neighbours8(cell, nrow, ncol);
      const heights = around.filter((next) => known[next]).map((next) => values[next]);
      if (heights.length * 2 < around.length) continue;
      const lowest = Math.min(...heights);
      if (Math.max(...heights) - lowest <= HOLE_FLATNESS * metrics.clearance) {
        updates.push([cell, Math.max(pitLimit, lowest)]);
      }
    }
    if (!updates.length) break;
    for (const [cell, value] of updates) {
      values[cell] = value;
      known[cell] = 1;
    }
  }
  const xStep = xAxis.width / (ncol - 1);
  const yStep = yAxis.width / (nrow - 1);
  const reach = Math.min(
    MAX_LOCAL_FLOOR_RADIUS,
    Math.max(
      FILL_RADIUS,
      Math.ceil((LOCAL_FLOOR_FRACTION * metrics.length) / Math.min(xStep, yStep)),
    ),
  );
  const floorLevel = (cell: number) =>
    sampled[cell] === 1 && Math.abs(values[cell] - floorZ) <= metrics.clearance;
  for (let cell = 0; cell < cells; cell++) {
    if (known[cell]) continue;
    const row = Math.floor(cell / ncol);
    const col = cell % ncol;
    const local: number[] = [];
    for (let r = Math.max(0, row - reach); r <= Math.min(nrow - 1, row + reach); r++) {
      for (let c = Math.max(0, col - reach); c <= Math.min(ncol - 1, col + reach); c++) {
        if (floorLevel(r * ncol + c)) local.push(values[r * ncol + c]);
      }
    }
    if (local.length) values[cell] = lowerMedian(local);
  }

  // Gaps: a vertex well below at least `GAP_MIN_NEIGHBOURS` of its 8 neighbours, which agree with
  // each other, sits in a narrow gap of a surface (a tabletop covered by few large Gaussians, with
  // the floor below showing through): it takes the lowest of them, repeated up to `FILL_RADIUS`
  // times so 2-3 vertex wide gaps close too.
  for (let pass = 0; pass < FILL_RADIUS; pass++) {
    const updates: [number, number][] = [];
    for (let cell = 0; cell < cells; cell++) {
      const higher = neighbours8(cell, nrow, ncol)
        .map((next) => values[next])
        .filter((value) => value > values[cell] + metrics.clearance);
      if (higher.length < GAP_MIN_NEIGHBOURS) continue;
      const lowest = Math.min(...higher);
      if (Math.max(...higher) - lowest <= HOLE_FLATNESS * metrics.clearance) {
        updates.push([cell, lowest]);
      }
    }
    if (!updates.length) break;
    for (const [cell, value] of updates) values[cell] = value;
  }

  // Flat regions are median-filtered (3x3), so a body resting on the highest vertices under it
  // sits on the surface rather than on its noise; any window spanning more than one clearance (an
  // edge, clutter) keeps its vertex unchanged.
  const smoothed = Float64Array.from(values);
  for (let cell = 0; cell < cells; cell++) {
    const window = [cell, ...neighbours8(cell, nrow, ncol)].map((next) => values[next]);
    if (Math.max(...window) - Math.min(...window) <= metrics.clearance) {
      window.sort((first, second) => first - second);
      smoothed[cell] = window[window.length >> 1];
    }
  }
  values.set(smoothed);

  return {
    floorZ,
    heightfield: encodeHeightfield(values, nrow, ncol, xAxis.width / 2, yAxis.width / 2, [
      xAxis.min + xAxis.width / 2,
      yAxis.min + yAxis.width / 2,
    ]),
  };
}

/** MuJoCo hfield from absolute body-frame vertex heights (row-major, mjModel order). */
function encodeHeightfield(
  values: Float64Array,
  nrow: number,
  ncol: number,
  halfX: number,
  halfY: number,
  [x, y]: readonly [number, number],
): SplatHeightfield {
  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  const span = high - low;
  const data = Array.from(values, (value) =>
    span > 0 ? Number(((value - low) / span).toFixed(6)) : 0,
  );
  return {
    nrow,
    ncol,
    data,
    size: [halfX, halfY, Math.max(span, MIN_RANGE), BASE_THICKNESS],
    position: [x, y, low],
  };
}

/**
 * Elevation of the heightfield surface at a body-frame XY, bilinearly interpolated between
 * samples (MuJoCo triangulates each cell; this matches it exactly at sample vertices).
 */
export function heightfieldElevationAt(
  heightfield: SplatHeightfield,
  x: number,
  y: number,
): number {
  const [hx, hy, range] = heightfield.size;
  const [px, py, pz] = heightfield.position;
  const u = Math.min(1, Math.max(0, (x - px + hx) / (2 * hx))) * (heightfield.ncol - 1);
  const v = Math.min(1, Math.max(0, (y - py + hy) / (2 * hy))) * (heightfield.nrow - 1);
  const c0 = Math.floor(u);
  const r0 = Math.floor(v);
  const c1 = Math.min(heightfield.ncol - 1, c0 + 1);
  const r1 = Math.min(heightfield.nrow - 1, r0 + 1);
  const at = (row: number, col: number) => heightfield.data[row * heightfield.ncol + col];
  const fu = u - c0;
  const fv = v - r0;
  const value =
    at(r0, c0) * (1 - fu) * (1 - fv) +
    at(r0, c1) * fu * (1 - fv) +
    at(r1, c0) * (1 - fu) * fv +
    at(r1, c1) * fu * fv;
  return pz + value * range;
}

/** World pose of the backdrop body: position and row-major 3x3 rotation. */
export interface BodyPose {
  position: ArrayLike<number>;
  rotation: ArrayLike<number>;
}

/** World footprint of a table box (center, half sizes, yaw in radians) and its current top. */
export interface TableFootprint {
  center: readonly [number, number];
  half: readonly [number, number];
  yaw: number;
  top: number;
}

/** Match height looks for the scanned surface this far (m) above and below the table's top. */
export const SURFACE_SEARCH_RANGE = 0.25;
/** Scan points needed under a table before its height counts as measured. */
const MIN_SURFACE_POINTS = 20;

/**
 * World height of the scanned surface under a table you placed (Match height to scan). Takes the
 * visible scan points over the table's footprint within `SURFACE_SEARCH_RANGE` of its current top,
 * lifted to the rendered surface like the heightfield, finds the fullest height band among them
 * (the tabletop: clutter above and reflections or the floor below hold fewer points), and returns
 * the median of the points within one step of that band, refit once around the first estimate.
 * Returns null when too few points lie there.
 */
export function measureScanSurface(
  points: readonly SplatPoint[],
  calibration: SplatCalibration,
  pose: BodyPose,
  table: TableFootprint,
): number | null {
  const sigmas: number[] = [];
  const centers = bodyFramePoints(points, calibration, sigmas);
  const metrics = sceneMetrics(centers);
  const body = liftBySplatSize(centers, sigmas, DEFAULT_SPLAT_SIZE, metrics.band);
  const { position: t, rotation: r } = pose;
  const cos = Math.cos(table.yaw);
  const sin = Math.sin(table.yaw);
  const heights: number[] = [];
  for (const point of body) {
    const z = r[6] * point.x + r[7] * point.y + r[8] * point.z + t[2];
    if (Math.abs(z - table.top) > SURFACE_SEARCH_RANGE) continue;
    const dx = r[0] * point.x + r[1] * point.y + r[2] * point.z + t[0] - table.center[0];
    const dy = r[3] * point.x + r[4] * point.y + r[5] * point.z + t[1] - table.center[1];
    if (Math.abs(cos * dx + sin * dy) > table.half[0]) continue;
    if (Math.abs(-sin * dx + cos * dy) > table.half[1]) continue;
    heights.push(z);
  }
  if (heights.length < MIN_SURFACE_POINTS) return null;
  const sorted = Float64Array.from(heights).sort();
  const bins = new Map<number, number>();
  let fullest = 0;
  for (const z of sorted) {
    const key = Math.floor(z / metrics.band);
    const count = (bins.get(key) ?? 0) + 1;
    bins.set(key, count);
    if (count > (bins.get(fullest) ?? 0)) fullest = key;
  }
  const median = (around: number): number | null => {
    const near = sorted.filter((z) => Math.abs(z - around) <= metrics.step);
    return near.length >= MIN_SURFACE_POINTS ? quantile(near, 0.5) : null;
  };
  const first = median((fullest + 0.5) * metrics.band);
  return first === null ? null : (median(first) ?? first);
}

/**
 * Body-frame point under the scan's horizontal center at floor height: the point the alignment
 * origin `[-cx, -cy, -floor + level]` places at `(0, 0, level)`. Viewport rotations of the
 * backdrop pivot here, so the scan turns in place instead of swinging around the PLY origin
 * (which can lie far outside the scan).
 */
export function backdropPivot(origin: Vec3Tuple, level: number): Vec3Tuple {
  return [-origin[0], -origin[1], level - origin[2]];
}

/**
 * Backdrop body position after a recalibration moved the alignment origin. The origin shift is a
 * body-frame offset, so it is rotated by the body's (kept) orientation `rotation` ([w, x, y, z],
 * identity when omitted) before being added to the current position.
 */
export function recalibratedBodyPosition(
  position: Vec3Tuple,
  previousOrigin: Vec3Tuple,
  nextOrigin: Vec3Tuple,
  rotation: QuaternionTuple = [1, 0, 0, 0],
): Vec3Tuple {
  const delta = [
    nextOrigin[0] - previousOrigin[0],
    nextOrigin[1] - previousOrigin[1],
    nextOrigin[2] - previousOrigin[2],
  ];
  const [w, x, y, z] = rotation;
  // v' = v + 2w(q x v) + 2 q x (q x v), for the unit quaternion q = (w, x, y, z).
  const cx = y * delta[2] - z * delta[1];
  const cy = z * delta[0] - x * delta[2];
  const cz = x * delta[1] - y * delta[0];
  const rotated = [
    delta[0] + 2 * (w * cx + y * cz - z * cy),
    delta[1] + 2 * (w * cy + z * cx - x * cz),
    delta[2] + 2 * (w * cz + x * cy - y * cx),
  ];
  return [position[0] + rotated[0], position[1] + rotated[1], position[2] + rotated[2]];
}

// ---------------------------------------------------------------------------------------------
// Auto level
// ---------------------------------------------------------------------------------------------

/** Below this fraction of floor-plane inliers among the lowest points the fit is unreliable. */
export const AUTO_LEVEL_MIN_INLIER_RATIO = 0.1;
const AUTO_LEVEL_SEED = 0x5eed;
const AUTO_LEVEL_ITERATIONS = 300;
/** Candidate floor planes must be within this angle of the current up axis (rejects walls). */
const AUTO_LEVEL_MAX_TILT_COS = Math.cos(Math.PI / 4);
/** Lowest fraction of the robust height range searched for the floor. */
const AUTO_LEVEL_LOW_FRACTION = 0.3;
const AUTO_LEVEL_MAX_POINTS = 50_000;
const AUTO_LEVEL_SCORE_POINTS = 4_000;
/** Leveling passes; each re-selects the lowest points along the previous pass's floor normal. */
const AUTO_LEVEL_MAX_PASSES = 5;
/** Leveling converges below this tilt; a scan this close to level is left unchanged. */
const AUTO_LEVEL_CONVERGED_DEGREES = 0.05;
const AUTO_LEVEL_REFINE_PASSES = 30;
/** Widest robust-fit window, as a fraction of the scene length (bounds a very noisy floor). */
const AUTO_LEVEL_MAX_WINDOW_FRACTION = 0.05;

export type AutoLevelResult =
  | { ok: true; calibration: SplatCalibration; inlierRatio: number }
  | { ok: false; calibration: SplatCalibration; inlierRatio: number; message: string };

/** Deterministic PRNG (mulberry32) so auto level gives the same answer for the same scan. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Plane {
  normal: Point;
  offset: number;
}

function planeDistance(plane: Plane, point: Point): number {
  const { normal } = plane;
  return normal.x * point.x + normal.y * point.y + normal.z * point.z - plane.offset;
}

function countInliers(points: readonly Point[], plane: Plane, distance: number): number {
  let count = 0;
  for (const point of points) if (Math.abs(planeDistance(plane, point)) <= distance) count++;
  return count;
}

/** Points in the lowest `AUTO_LEVEL_LOW_FRACTION` of the robust (1st-99th percentile) height range. */
function lowestPoints(points: readonly Point[], distance: number): Point[] {
  const heights = Float64Array.from(points, (point) => point.z).sort();
  const low = quantile(heights, 0.01);
  const high = quantile(heights, 0.99);
  const cutoff = low + Math.max((high - low) * AUTO_LEVEL_LOW_FRACTION, 5 * distance);
  return points.filter((point) => point.z <= cutoff);
}

/**
 * Deterministic RANSAC over the lowest points. Candidate planes must be within 45° of the current
 * up axis; the level plane through the densest height band is tried first, so an already level
 * scan keeps its orientation unless a tilted plane fits strictly better. `steep` reports that the
 * best plane of any orientation is more than 45° from up (a sideways or upside-down scan).
 */
function searchFloorPlane(
  candidates: readonly Point[],
  distance: number,
): { best: Plane | null; steep: boolean } {
  const scoring = stride(candidates, AUTO_LEVEL_SCORE_POINTS);
  let best: Plane | null = null;
  let bestScore = -1;
  let anyScore = -1;
  let anySteep = false;
  const consider = (plane: Plane) => {
    const score = countInliers(scoring, plane, distance);
    const steep = plane.normal.z < AUTO_LEVEL_MAX_TILT_COS;
    if (score > anyScore) {
      anyScore = score;
      anySteep = steep;
    }
    if (!steep && score > bestScore) {
      bestScore = score;
      best = plane;
    }
  };

  const bands = new Map<number, number>();
  let densest = 0;
  for (const point of scoring) {
    const key = Math.floor(point.z / distance);
    const count = (bands.get(key) ?? 0) + 1;
    bands.set(key, count);
    if (count > (bands.get(densest) ?? 0)) densest = key;
  }
  consider({ normal: { x: 0, y: 0, z: 1 }, offset: (densest + 0.5) * distance });

  const random = seededRandom(AUTO_LEVEL_SEED);
  for (let iteration = 0; iteration < AUTO_LEVEL_ITERATIONS; iteration++) {
    const a = candidates[Math.floor(random() * candidates.length)];
    const b = candidates[Math.floor(random() * candidates.length)];
    const c = candidates[Math.floor(random() * candidates.length)];
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-12) continue;
    const sign = nz < 0 ? -1 : 1;
    nx = (sign * nx) / length;
    ny = (sign * ny) / length;
    nz = (sign * nz) / length;
    consider({ normal: { x: nx, y: ny, z: nz }, offset: nx * a.x + ny * a.y + nz * a.z });
  }
  return { best, steep: anySteep && anyScore > bestScore };
}

/**
 * Robust plane refinement: iteratively reweighted least squares of `z = a x + b y + c` with Tukey
 * biweights. The weight window adapts to the floor's own spread (3 robust sigmas from the median
 * absolute residual, at least 3 inlier distances, at most `maxWindow`), so a floor layer thicker
 * than the inlier distance still pulls the plane to its middle instead of leaving it where it
 * started. Iterates until the plane stops moving.
 */
function refinePlane(
  points: readonly Point[],
  plane: Plane,
  distance: number,
  maxWindow: number,
): Plane {
  let current = plane;
  let window = 3 * distance;
  for (let pass = 0; pass < AUTO_LEVEL_REFINE_PASSES; pass++) {
    const near: number[] = [];
    for (const point of points) {
      const residual = Math.abs(planeDistance(current, point));
      if (residual <= window) near.push(residual);
    }
    if (near.length < 3) break;
    const sorted = Float64Array.from(near).sort();
    const sigma = 1.4826 * sorted[sorted.length >> 1];
    window = Math.min(maxWindow, Math.max(3 * distance, 3 * sigma));

    let sw = 0;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    const weighted: [Point, number][] = [];
    for (const point of points) {
      const u = planeDistance(current, point) / window;
      if (Math.abs(u) >= 1) continue;
      const weight = (1 - u * u) ** 2;
      weighted.push([point, weight]);
      sw += weight;
      sx += weight * point.x;
      sy += weight * point.y;
      sz += weight * point.z;
    }
    if (weighted.length < 3 || sw <= 0) break;
    const mx = sx / sw;
    const my = sy / sw;
    const mz = sz / sw;
    let xx = 0;
    let xy = 0;
    let yy = 0;
    let xz = 0;
    let yz = 0;
    for (const [point, weight] of weighted) {
      const dx = point.x - mx;
      const dy = point.y - my;
      const dz = point.z - mz;
      xx += weight * dx * dx;
      xy += weight * dx * dy;
      yy += weight * dy * dy;
      xz += weight * dx * dz;
      yz += weight * dy * dz;
    }
    const det = xx * yy - xy * xy;
    if (Math.abs(det) < 1e-12) break;
    const a = (xz * yy - yz * xy) / det;
    const b = (yz * xx - xz * xy) / det;
    const length = Math.hypot(a, b, 1);
    const normal = { x: -a / length, y: -b / length, z: 1 / length };
    const next = { normal, offset: normal.x * mx + normal.y * my + normal.z * mz };
    const turn =
      1 -
      (next.normal.x * current.normal.x +
        next.normal.y * current.normal.y +
        next.normal.z * current.normal.z);
    const shift = Math.abs(next.offset - current.offset);
    current = next;
    if (turn < 1e-14 && shift < 1e-9 * distance) break;
  }
  return current;
}

/**
 * Calibration whose body +z is the body-frame floor normal `normal` of `calibration`: `upAxis`
 * becomes the raw axis nearest to the normal and `tiltX`/`tiltY` absorb the residual (unrounded).
 */
function leveledCalibration(calibration: SplatCalibration, normal: Point): SplatCalibration {
  // Floor normal in raw PLY coordinates: R^T * n (R is a rotation, so its inverse is R^T).
  const m = rotationMatrix(calibrationRotation(calibration));
  const raw = [
    m[0] * normal.x + m[3] * normal.y + m[6] * normal.z,
    m[1] * normal.x + m[4] * normal.y + m[7] * normal.z,
    m[2] * normal.x + m[5] * normal.y + m[8] * normal.z,
  ];
  const axisIndex = [0, 1, 2].reduce((bestIndex, index) =>
    Math.abs(raw[index]) > Math.abs(raw[bestIndex]) ? index : bestIndex,
  );
  const upAxis = `${raw[axisIndex] < 0 ? '-' : '+'}${'xyz'[axisIndex]}` as SplatUpAxis;
  const up = rotationMatrix(UP_AXIS_ROTATION[upAxis]);
  const mx = up[0] * raw[0] + up[1] * raw[1] + up[2] * raw[2];
  const my = up[3] * raw[0] + up[4] * raw[1] + up[5] * raw[2];
  const mz = up[6] * raw[0] + up[7] * raw[1] + up[8] * raw[2];
  // Rx(tiltX) zeroes the y component, then Ry(tiltY) the x component, leaving +z.
  const toDegrees = (radians: number) => (radians * 180) / Math.PI;
  return {
    ...calibration,
    upAxis,
    tiltX: toDegrees(Math.atan2(my, mz)),
    tiltY: toDegrees(Math.atan2(-mx, Math.hypot(my, mz))),
  };
}

/** Raw PLY direction that the calibration maps to body +z (`R^T * e_z`). */
function rawUp(calibration: SplatCalibration): [number, number, number] {
  const m = rotationMatrix(calibrationRotation(calibration));
  return [m[6], m[7], m[8]];
}

function degreesBetween(a: readonly number[], b: readonly number[]): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
}

function floorNotFound(inlierRatio: number | null, steep: boolean): string {
  const fit =
    inlierRatio === null
      ? 'no floor plane was found in the lowest part of the splat'
      : `only ${Math.round(inlierRatio * 100)}% of the lowest points fit a floor plane`;
  const hint = steep ? ' The best-fitting plane is more than 45° from the current up axis.' : '';
  return (
    `Auto level could not detect the floor: ${fit}. The calibration was not changed; ` +
    `set Up axis and Tilt X/Y, or rotate the backdrop with the gizmo; tilt is applied to the splat calibration.${hint}`
  );
}

/**
 * Levels the scan on its floor. Each pass takes the visible points in the lowest part of the scan
 * along the current up axis, fits the floor plane (deterministic RANSAC on the first pass, then a
 * robust least-squares refinement), and re-levels on its normal; passes repeat, re-selecting the
 * lowest points along the new normal, until the remaining tilt is below
 * `AUTO_LEVEL_CONVERGED_DEGREES` (at most `AUTO_LEVEL_MAX_PASSES`). Leveling an already leveled scan
 * therefore returns the same calibration. The inlier distance is the scale-aware height band.
 * Fails (calibration unchanged) when fewer than `AUTO_LEVEL_MIN_INLIER_RATIO` of the searched
 * points lie on the fitted plane.
 */
export function autoLevelCalibration(
  points: readonly SplatPoint[],
  calibration: SplatCalibration,
): AutoLevelResult {
  const fail = (inlierRatio: number, message: string): AutoLevelResult => ({
    ok: false,
    calibration,
    inlierRatio,
    message,
  });
  const tooFew = 'The splat has too few visible points to find a floor.';
  let current = calibration;
  let previous: Plane | null = null;
  let inlierRatio = 0;
  for (let pass = 0; pass < AUTO_LEVEL_MAX_PASSES; pass++) {
    const body = stride(bodyFramePoints(points, current), AUTO_LEVEL_MAX_POINTS);
    if (body.length < 3) return fail(0, tooFew);
    const metrics = sceneMetrics(body);
    const distance = metrics.band;
    const candidates = lowestPoints(body, distance);
    if (candidates.length < 3) return fail(0, tooFew);
    let plane: Plane;
    let steep = false;
    if (previous) {
      // The previous floor normal is this frame's +z, so its plane is level at the same offset.
      plane = { normal: { x: 0, y: 0, z: 1 }, offset: previous.offset };
    } else {
      const search = searchFloorPlane(candidates, distance);
      if (!search.best) return fail(0, floorNotFound(null, search.steep));
      plane = search.best;
      steep = search.steep;
    }
    const maxWindow = Math.max(3 * distance, AUTO_LEVEL_MAX_WINDOW_FRACTION * metrics.length);
    plane = refinePlane(candidates, plane, distance, maxWindow);
    inlierRatio = countInliers(candidates, plane, distance) / candidates.length;
    if (inlierRatio < AUTO_LEVEL_MIN_INLIER_RATIO) {
      return fail(inlierRatio, floorNotFound(inlierRatio, steep));
    }
    const tilt = (Math.acos(Math.min(1, plane.normal.z)) * 180) / Math.PI;
    current = leveledCalibration(current, plane.normal);
    previous = plane;
    if (tilt < AUTO_LEVEL_CONVERGED_DEGREES) break;
  }
  const round = (degrees: number) => Number(degrees.toFixed(2)) + 0;
  const leveled = { ...current, tiltX: round(current.tiltX), tiltY: round(current.tiltY) };
  if (degreesBetween(rawUp(calibration), rawUp(leveled)) < AUTO_LEVEL_CONVERGED_DEGREES) {
    return { ok: true, calibration, inlierRatio };
  }
  return { ok: true, calibration: leveled, inlierRatio };
}

/** Another up axis replaces the current one only when its floor layer is this much fuller. */
const ORIENTATION_SWITCH_RATIO = 1.25;

/** Visible points within one height band of the floor surface under `calibration`. */
function floorLayerCount(points: readonly SplatPoint[], calibration: SplatCalibration): number {
  const body = bodyFramePoints(points, calibration);
  const metrics = sceneMetrics(body);
  const floor = floorSurface(body, metrics.band, 2 * metrics.clearance);
  if (floor === null) return 0;
  let count = 0;
  for (const point of body) if (Math.abs(point.z - floor) <= metrics.band) count++;
  return count;
}

/**
 * Up axis and leveling for a newly loaded scan in an unknown frame (PLYs from other tools are
 * often y-up or y-down). Auto level runs from every raw up axis; each leveled orientation is scored
 * by how many points lie in its floor layer, since the floor is normally the largest flat layer of
 * a scan and a wall or ceiling taken as floor holds fewer points. The current up axis is kept
 * unless another one's floor layer is `ORIENTATION_SWITCH_RATIO` times fuller (or the current one
 * finds no floor). Returns the failed current-axis result when no orientation finds a floor.
 */
export function detectSplatOrientation(
  points: readonly SplatPoint[],
  calibration: SplatCalibration,
): AutoLevelResult {
  const sample = stride(points, AUTO_LEVEL_MAX_POINTS);
  const options = SPLAT_UP_AXES.map((upAxis) => {
    const start =
      upAxis === calibration.upAxis ? calibration : { ...calibration, upAxis, tiltX: 0, tiltY: 0 };
    const result = autoLevelCalibration(sample, start);
    return { upAxis, result, score: result.ok ? floorLayerCount(sample, result.calibration) : -1 };
  });
  const current = options.find((option) => option.upAxis === calibration.upAxis) ?? options[0];
  const challenger = options.reduce((best, option) => (option.score > best.score ? option : best));
  const chosen =
    challenger.score > 0 &&
    (current.score <= 0 || challenger.score > ORIENTATION_SWITCH_RATIO * current.score)
      ? challenger
      : current;
  return chosen.result.ok ? chosen.result : current.result;
}
