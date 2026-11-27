// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Fit a pinhole camera (MuJoCo world position, look-at target, vertical field of view) to photo
 * pixels of known world points, such as a table top's corners. Pure math: no scene access.
 *
 * Conventions: pixels are measured from the image's top-left corner, +u right and +v down, with the
 * principal point at the image centre and square pixels (what MuJoCo cameras render). Internally
 * the camera frame is the computer-vision one (x right, y down, z forward); MuJoCo cameras look
 * along their local -Z with +Y up, which is the same physical frame.
 */

export type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];

export interface CameraFitPoint {
  world: readonly [number, number, number];
  pixel: readonly [number, number];
}

/**
 * A known straight world edge (two points on it, such as a table edge's corners) and any two
 * pixels along its image: the corners themselves may be outside the photo.
 */
export interface CameraFitLine {
  world: readonly [readonly [number, number, number], readonly [number, number, number]];
  pixels: readonly [readonly [number, number], readonly [number, number]];
}

export interface CameraFitInput {
  points: readonly CameraFitPoint[];
  lines?: readonly CameraFitLine[];
  width: number;
  height: number;
  /** Known vertical field of view in degrees; omit to estimate it. */
  fovy?: number;
}

export interface CameraFitResult {
  position: Vec3;
  target: Vec3;
  fovy: number;
  /**
   * Image rotation about the view axis in the best unconstrained fit, degrees. Cameras set from a
   * position and target are level, so this tilt is left out of the result and its error.
   */
  rollDegrees: number;
  /** Set when the fit is ambiguous, with what to pass to resolve it. */
  warning?: string;
  /** Pixel distance between each given pixel and where the returned camera sees its world point. */
  reprojectionError: { mean: number; max: number; perPoint: number[] };
}

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: readonly number[], b: readonly number[]): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
const add = (a: readonly number[], b: readonly number[]): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
const scale = (a: readonly number[], s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: readonly number[], b: readonly number[]): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: readonly number[]) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: readonly number[]): Vec3 => scale(a, 1 / norm(a));

/** Solves a small dense linear system in place (Gaussian elimination, partial pivoting). */
function solve(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const a = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    }
    if (Math.abs(a[pivot][column]) < 1e-12) return null;
    [a[column], a[pivot]] = [a[pivot], a[column]];
    for (let row = 0; row < n; row++) {
      if (row === column) continue;
      const factor = a[row][column] / a[column][column];
      for (let k = column; k <= n; k++) a[row][k] -= factor * a[column][k];
    }
  }
  return a.map((row, index) => row[n] / row[index]);
}

/** Rotation matrix (rows map world to camera) from a rotation vector, Rodrigues' formula. */
function rotationFromVector(v: readonly number[]): Mat3 {
  const angle = norm(v);
  if (angle < 1e-12)
    return [
      [1, -v[2], v[1]],
      [v[2], 1, -v[0]],
      [-v[1], v[0], 1],
    ];
  const [x, y, z] = scale(v, 1 / angle);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    [c + x * x * t, x * y * t - z * s, x * z * t + y * s],
    [y * x * t + z * s, c + y * y * t, y * z * t - x * s],
    [z * x * t - y * s, z * y * t + x * s, c + z * z * t],
  ];
}

function multiply(a: Mat3, b: Mat3): Mat3 {
  const out: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return out;
}

interface Pose {
  /** Rows map world directions into the camera frame (x right, y down, z forward). */
  rotation: Mat3;
  center: Vec3;
  /** Focal length in pixels. */
  focal: number;
}

function project(pose: Pose, world: readonly number[], cx: number, cy: number) {
  const p = sub(world, pose.center);
  const x = dot(pose.rotation[0], p);
  const y = dot(pose.rotation[1], p);
  const z = dot(pose.rotation[2], p);
  return { u: cx + (pose.focal * x) / z, v: cy + (pose.focal * y) / z, depth: z };
}

function residuals(pose: Pose, input: CameraFitInput): number[] {
  const cx = input.width / 2;
  const cy = input.height / 2;
  const out: number[] = [];
  for (const point of input.points) {
    const { u, v, depth } = project(pose, point.world, cx, cy);
    // Points behind the camera get a large, smooth penalty instead of a mirrored projection.
    if (depth <= 1e-6) out.push(1e4, 1e4);
    else out.push(u - point.pixel[0], v - point.pixel[1]);
  }
  for (const line of input.lines ?? []) out.push(...lineResiduals(pose, line, cx, cy));
  return out;
}

/** Pixel distance from each given pixel to the image of the world line. */
function lineResiduals(pose: Pose, line: CameraFitLine, cx: number, cy: number): number[] {
  const a = project(pose, line.world[0], cx, cy);
  const b = project(pose, line.world[1], cx, cy);
  if (a.depth <= 1e-6 || b.depth <= 1e-6) return [1e4, 1e4];
  const du = b.u - a.u;
  const dv = b.v - a.v;
  const length = Math.hypot(du, dv);
  if (length < 1e-9) return [1e4, 1e4];
  return line.pixels.map(([u, v]) => (du * (v - a.v) - dv * (u - a.u)) / length);
}

/** Every world point the fit knows: corners and the ends of the line constraints. */
function worldPoints(input: CameraFitInput): (readonly number[])[] {
  return [
    ...input.points.map((point) => point.world),
    ...(input.lines ?? []).flatMap((line) => [line.world[0], line.world[1]]),
  ];
}

/**
 * Start poses without a homography (fewer than 4 corners): level cameras around the points'
 * centre at several headings, pitches, distances, and lenses. The best few by pixel error are
 * refined.
 */
function searchStarts(input: CameraFitInput, focalHint: number | null): Pose[] {
  const world = worldPoints(input);
  const centre = scale(
    world.reduce<Vec3>((sum, point) => add(sum, point), [0, 0, 0]),
    1 / world.length,
  );
  const extent = Math.max(0.1, ...world.map((point) => norm(sub(point, centre))));
  const focals =
    focalHint !== null
      ? [focalHint]
      : [30, 45, 60, 75, 90].map((f) => focalFromFovy(f, input.height));
  const candidates: { pose: Pose; cost: number }[] = [];
  for (let heading = 0; heading < 24; heading++) {
    const yaw = (heading * Math.PI) / 12;
    for (const pitchDegrees of [-15, -30, -45, -60, -75]) {
      const forward = forwardFromAngles(yaw, (pitchDegrees * Math.PI) / 180);
      for (const distance of [1.5, 2.5, 4, 6].map((factor) => factor * extent)) {
        for (const focal of focals) {
          const pose: Pose = {
            rotation: levelRotation(forward),
            center: sub(centre, scale(forward, distance)),
            focal,
          };
          candidates.push({ pose, cost: sumSquares(residuals(pose, input)) });
        }
      }
    }
  }
  return candidates
    .sort((a, b) => a.cost - b.cost)
    .slice(0, 8)
    .map((candidate) => candidate.pose);
}

const sumSquares = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value * value, 0);

/** Best-fit plane through the points: the normal is the smallest-variance direction. */
function pointPlane(points: readonly CameraFitPoint[]) {
  const centroid = scale(
    points.reduce<Vec3>((sum, point) => add(sum, point.world), [0, 0, 0]),
    1 / points.length,
  );
  const spread = points.map((point) => sub(point.world, centroid));
  const covariance: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const d of spread)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) covariance[i][j] += d[i] * d[j];
  let normal: Vec3 = [0, 0, 1];
  // Inverse power iteration on the (regularized) covariance finds its smallest eigenvector.
  const trace = covariance[0][0] + covariance[1][1] + covariance[2][2];
  const shifted = covariance.map((row, i) =>
    row.map((value, j) => value + (i === j ? trace * 1e-9 + 1e-12 : 0)),
  );
  for (let iteration = 0; iteration < 50; iteration++) {
    const next = solve(shifted, normal);
    if (!next) break;
    normal = unit(next);
  }
  const seed: Vec3 = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = unit(cross(normal, seed));
  const e2 = cross(normal, e1);
  return { centroid, spread, normal, e1, e2 };
}

/** Pose from a plane-to-image homography (Zhang); the focal length comes from it when unknown. */
function initialPose(input: CameraFitInput, focalHint: number | null): Pose | null {
  const points = input.points;
  const { centroid, spread, normal, e1, e2 } = pointPlane(points);
  const planar = spread.map((d) => [dot(d, e1), dot(d, e2)] as const);
  const spreadScale = Math.sqrt(
    planar.reduce((sum, [a, b]) => sum + a * a + b * b, 0) / planar.length,
  );
  if (!(spreadScale > 1e-9)) return null;
  const cx = input.width / 2;
  const cy = input.height / 2;
  const pixelScale = input.height;
  // DLT with H[2][2] = 1 on normalized coordinates, least squares for more than four points.
  const rows: number[][] = [];
  const rhs: number[] = [];
  points.forEach((point, index) => {
    const a = planar[index][0] / spreadScale;
    const b = planar[index][1] / spreadScale;
    const u = (point.pixel[0] - cx) / pixelScale;
    const v = (point.pixel[1] - cy) / pixelScale;
    rows.push([a, b, 1, 0, 0, 0, -u * a, -u * b]);
    rhs.push(u);
    rows.push([0, 0, 0, a, b, 1, -v * a, -v * b]);
    rhs.push(v);
  });
  const normalMatrix = Array.from({ length: 8 }, (_, i) =>
    Array.from({ length: 8 }, (_, j) => rows.reduce((sum, row) => sum + row[i] * row[j], 0)),
  );
  const normalVector = Array.from({ length: 8 }, (_, i) =>
    rows.reduce((sum, row, k) => sum + row[i] * rhs[k], 0),
  );
  const h = solve(normalMatrix, normalVector);
  if (!h) return null;
  const H = [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];
  // Columns of K^-1 H are proportional to [R e1, R e2, R(c - C)]: orthogonal, equal length.
  let focal = focalHint === null ? null : focalHint / pixelScale;
  if (focal === null) {
    const estimates: number[] = [];
    const orthogonal = -(H[0][0] * H[0][1] + H[1][0] * H[1][1]) / (H[2][0] * H[2][1]);
    const equal =
      -(H[0][0] ** 2 + H[1][0] ** 2 - H[0][1] ** 2 - H[1][1] ** 2) / (H[2][0] ** 2 - H[2][1] ** 2);
    for (const estimate of [orthogonal, equal]) {
      if (Number.isFinite(estimate) && estimate > 0.01 && estimate < 400)
        estimates.push(Math.sqrt(estimate));
    }
    // A face-on view leaves the focal length undetermined; start from a 60 degree lens.
    focal = estimates.length
      ? estimates.reduce((s, v) => s + v, 0) / estimates.length
      : 0.5 / Math.tan(Math.PI / 6);
  }
  const g = [0, 1, 2].map((column) => [H[0][column] / focal!, H[1][column] / focal!, H[2][column]]);
  let lambda = 2 / (norm(g[0]) + norm(g[1]));
  if (g[2][2] * lambda < 0) lambda = -lambda;
  const r1 = unit(scale(g[0], lambda));
  let r2 = scale(g[1], lambda);
  r2 = unit(sub(r2, scale(r1, dot(r1, r2))));
  const r3 = cross(r1, r2);
  // R maps e1, e2, n to r1, r2, r3: R = [r1 r2 r3] [e1 e2 n]^T, with plane coords scaled back.
  const columns: Mat3 = [r1, r2, r3];
  const basis: Mat3 = [e1, e2, normal];
  const rotation: Mat3 = [0, 1, 2].map((row) =>
    [0, 1, 2].map((col) => columns.reduce((sum, c, k) => sum + c[row] * basis[k][col], 0)),
  ) as Mat3;
  const translation = scale(g[2], lambda * spreadScale);
  // p_cam = R (p - C) and p_cam(centroid) = t  =>  C = centroid - R^T t.
  const rt: Vec3 = [0, 1, 2].map((col) =>
    dot([rotation[0][col], rotation[1][col], rotation[2][col]], translation),
  ) as Vec3;
  return { rotation, center: sub(centroid, rt), focal: focal * pixelScale };
}

/** Levenberg-Marquardt on pixel residuals over the parameters `toPose` reads. */
function minimize(
  toPose: (parameters: readonly number[]) => Pose,
  start: readonly number[],
  input: CameraFitInput,
  steps: readonly number[],
): number[] {
  let x = [...start];
  let cost = sumSquares(residuals(toPose(x), input));
  let damping = 1e-3;
  for (let iteration = 0; iteration < 200; iteration++) {
    const base = residuals(toPose(x), input);
    const jacobian = x.map((_, p) => {
      const moved = [...x];
      moved[p] += steps[p];
      return residuals(toPose(moved), input).map((value, k) => (value - base[k]) / steps[p]);
    });
    const jtj = jacobian.map((a) =>
      jacobian.map((b) => a.reduce((sum, value, k) => sum + value * b[k], 0)),
    );
    const jtr = jacobian.map(
      (column) => -column.reduce((sum, value, k) => sum + value * base[k], 0),
    );
    let improved = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const damped = jtj.map((row, i) =>
        row.map((value, j) => value + (i === j ? damping * (value + 1e-9) : 0)),
      );
      const step = solve(damped, jtr);
      if (!step) {
        damping *= 10;
        continue;
      }
      const candidate = x.map((value, p) => value + step[p]);
      const candidateCost = sumSquares(residuals(toPose(candidate), input));
      if (candidateCost < cost) {
        improved = cost - candidateCost > 1e-12 * (1 + cost);
        x = candidate;
        cost = candidateCost;
        damping = Math.max(damping / 3, 1e-9);
        break;
      }
      damping *= 10;
    }
    if (!improved) break;
  }
  return x;
}

/** Free fit: position, a rotation update about the start orientation, and (optionally) focal. */
function refineFree(start: Pose, input: CameraFitInput, fixedFocal: boolean): Pose {
  const toPose = (x: readonly number[]): Pose => ({
    center: [x[0], x[1], x[2]],
    rotation: multiply(rotationFromVector([x[3], x[4], x[5]]), start.rotation),
    focal: fixedFocal ? start.focal : start.focal * Math.exp(x[6]),
  });
  const x0 = [...start.center, 0, 0, 0, ...(fixedFocal ? [] : [0])];
  return toPose(minimize(toPose, x0, input, [1e-6, 1e-6, 1e-6, 1e-7, 1e-7, 1e-7, 1e-7]));
}

/**
 * The level camera add_camera and aim_camera build for a view direction (no roll): right is
 * forward x world up, or forward x world +Y when looking nearly straight up or down.
 */
function levelRotation(forward: Vec3): Mat3 {
  const reference: Vec3 = Math.abs(forward[2]) > 0.98 ? [0, 1, 0] : [0, 0, 1];
  const right = unit(cross(forward, reference));
  const down = cross(forward, right);
  return [right, down, forward];
}

function forwardFromAngles(yaw: number, pitch: number): Vec3 {
  return [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)];
}

/** Fit restricted to cameras without roll, which is what a position and target can express. */
function refineLevel(start: Pose, input: CameraFitInput, fixedFocal: boolean): Pose {
  const forward = start.rotation[2];
  const toPose = (x: readonly number[]): Pose => ({
    center: [x[0], x[1], x[2]],
    rotation: levelRotation(forwardFromAngles(x[3], x[4])),
    focal: fixedFocal ? start.focal : start.focal * Math.exp(x[5]),
  });
  const x0 = [
    ...start.center,
    Math.atan2(forward[1], forward[0]),
    Math.asin(Math.max(-1, Math.min(1, forward[2]))),
    ...(fixedFocal ? [] : [0]),
  ];
  return toPose(minimize(toPose, x0, input, [1e-6, 1e-6, 1e-6, 1e-7, 1e-7, 1e-7]));
}

/** Rotation of the image about the optical axis, relative to the level camera, in degrees. */
function rollDegrees(pose: Pose): number {
  const level = levelRotation(pose.rotation[2]);
  const right = pose.rotation[0];
  return (Math.atan2(dot(right, level[1]), dot(right, level[0])) * 180) / Math.PI;
}

const focalFromFovy = (fovy: number, height: number) =>
  height / 2 / Math.tan((fovy * Math.PI) / 360);

/** Vertical fields of view of real desk cameras and phones; outside this a fit is suspect. */
export const MIN_PLAUSIBLE_FOVY = 20;
export const MAX_PLAUSIBLE_FOVY = 100;

export function fitCamera(input: CameraFitInput): CameraFitResult {
  const { points, width, height } = input;
  const lines = input.lines ?? [];
  const fixedFocal = input.fovy !== undefined;
  // Each corner and each line gives two equations; the camera has 6 unknowns, 7 with the lens.
  const equations = 2 * points.length + 2 * lines.length;
  if (points.length + lines.length < 2 || equations < (fixedFocal ? 6 : 8)) {
    throw new Error(
      'Give at least 4 corners, or fewer corners plus table-edge lines (2 corners and 2 lines, for example); with fovy, 3 constraints are enough.',
    );
  }
  if (!(width > 0 && height > 0)) throw new Error('width and height must be positive pixel sizes.');
  const hint = fixedFocal ? focalFromFovy(input.fovy!, height) : null;
  const starts: Pose[] = [];
  const homography = points.length >= 4 ? initialPose(input, hint) : null;
  if (homography) starts.push(homography);
  // Four or more corners on one line give no homography; without lines that cannot be fixed.
  if (!homography && (points.length < 4 || lines.length)) {
    starts.push(...searchStarts(input, hint));
  }
  if (!fixedFocal && homography) {
    // The focal estimate from four points is noisy; also try common lenses from the same view.
    for (const fovy of [30, 45, 60, 75, 90]) {
      const alternative = initialPose(input, focalFromFovy(fovy, height));
      if (alternative) starts.push(alternative);
    }
  }
  if (!starts.length) {
    throw new Error('The points must span an area (not lie on one line), and be distinct.');
  }
  let free: Pose | null = null;
  let bestCost = Infinity;
  for (const start of starts) {
    const pose = refineFree(start, input, fixedFocal);
    const cost = sumSquares(residuals(pose, input));
    if (cost < bestCost) {
      free = pose;
      bestCost = cost;
    }
  }
  const pose = refineLevel(free!, input, fixedFocal);
  const cx = width / 2;
  const cy = height / 2;
  const perPoint = [
    ...points.map((point) => {
      const { u, v, depth } = project(pose, point.world, cx, cy);
      return depth <= 0 ? Infinity : Math.hypot(u - point.pixel[0], v - point.pixel[1]);
    }),
    // A line's error is the larger of its two pixels' distances from the projected edge.
    ...lines.map((line) => Math.max(...lineResiduals(pose, line, cx, cy).map(Math.abs))),
  ];
  if (perPoint.some((value) => !Number.isFinite(value))) {
    throw new Error(
      'No camera sees all points in front of it. Check the pixel and world point order.',
    );
  }
  // Look at the points' centre along the optical axis, so target - position is the view direction.
  const forward: Vec3 = [pose.rotation[2][0], pose.rotation[2][1], pose.rotation[2][2]];
  const known = worldPoints(input);
  const centroid = scale(
    known.reduce<Vec3>((sum, point) => add(sum, point), [0, 0, 0]),
    1 / known.length,
  );
  const distance = Math.max(dot(sub(centroid, pose.center), forward), 0.05);
  const round = (value: number) => Number(value.toFixed(4));
  // Face-on to the points' plane, a wider lens further away looks the same as a narrower one closer.
  const faceOn = points.length >= 3 && Math.abs(dot(forward, pointPlane(points).normal)) > 0.985;
  // Lens and distance trade off when a different lens fits as well (face-on views, or two
  // corners with edge lines, which give directions but no scale).
  const fitCost = sumSquares(residuals(pose, input));
  const lensAmbiguous =
    !fixedFocal &&
    [0.8, 1.25].some((factor) => {
      const other = refineLevel({ ...pose, focal: pose.focal * factor }, input, true);
      return sumSquares(residuals(other, input)) <= Math.max(4 * fitCost, equations * 0.25);
    });
  const fovy = (2 * Math.atan(height / 2 / pose.focal) * 180) / Math.PI;
  const implausible = !fixedFocal && (fovy < MIN_PLAUSIBLE_FOVY || fovy > MAX_PLAUSIBLE_FOVY);
  const warning = implausible
    ? `The fitted lens (fovy ${fovy.toFixed(1)} degrees) is unlike a desk camera or phone (${MIN_PLAUSIBLE_FOVY}-${MAX_PLAUSIBLE_FOVY}). Check each pixel belongs to its world point: a table's width and depth swapped (corners in the wrong order) can fit exactly as a telephoto. Pass fovy if you know the lens.`
    : (faceOn || lensAmbiguous) && !fixedFocal
      ? 'These points leave lens and distance ambiguous (a wider lens further away fits as well). Pass fovy (the camera lens), or add another point such as the robot base, and fit again.'
      : undefined;
  return {
    position: pose.center.map(round) as Vec3,
    target: add(pose.center, scale(forward, distance)).map(round) as Vec3,
    rollDegrees: Number(rollDegrees(free!).toFixed(2)),
    ...(warning ? { warning } : {}),
    fovy: Number(fovy.toFixed(2)),
    reprojectionError: {
      mean: Number((perPoint.reduce((s, v) => s + v, 0) / perPoint.length).toFixed(2)),
      max: Number(Math.max(...perPoint).toFixed(2)),
      perPoint: perPoint.map((value) => Number(value.toFixed(2))),
    },
  };
}

export interface PixelToWorldInput {
  /** A level camera as fit_camera returns it (or add_camera takes it). */
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  fovy: number;
  width: number;
  height: number;
  pixels: readonly (readonly [number, number])[];
  /** World height of the horizontal plane the pixels lie on, such as the table top. */
  planeZ: number;
}

/**
 * Where photo pixels land on a horizontal plane, seen through a level camera: each pixel's ray is
 * intersected with z = planeZ. Null for a pixel whose ray never reaches the plane (above the
 * horizon, or the camera on the wrong side).
 */
export function pixelToWorld(input: PixelToWorldInput): { world: (Vec3 | null)[] } {
  const forward = sub(input.target, input.position);
  if (!(norm(forward) > 1e-9)) throw new Error('position and target must differ.');
  if (!(input.width > 0 && input.height > 0 && input.fovy > 0 && input.fovy < 180)) {
    throw new Error('width, height, and fovy must be positive (fovy under 180).');
  }
  const rotation = levelRotation(unit(forward));
  const focal = focalFromFovy(input.fovy, input.height);
  const cx = input.width / 2;
  const cy = input.height / 2;
  const round = (value: number) => Number(value.toFixed(4));
  return {
    world: input.pixels.map(([u, v]) => {
      const camera = [(u - cx) / focal, (v - cy) / focal, 1];
      // World direction = R^T * camera direction (rows of R are the camera axes in world).
      const direction = [0, 1, 2].map(
        (axis) =>
          rotation[0][axis] * camera[0] +
          rotation[1][axis] * camera[1] +
          rotation[2][axis] * camera[2],
      );
      if (Math.abs(direction[2]) < 1e-9) return null;
      const t = (input.planeZ - input.position[2]) / direction[2];
      if (!(t > 0)) return null;
      return [0, 1, 2].map((axis) => round(input.position[axis] + t * direction[axis])) as Vec3;
    }),
  };
}
