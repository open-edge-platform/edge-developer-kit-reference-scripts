// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import * as THREE from 'three';

/**
 * Pure interaction math for viewport transforms (gizmo handles and direct object drags).
 *
 * Everything that is authored lives in the "scene frame" (MuJoCo, Z-up). Rays and screen
 * projections live in the three.js world frame; `sceneToWorld` converts between the two. Drags
 * follow the conventions of DCC/CAD tools:
 * - translate along an axis: closest point between the pointer ray and the axis line, so the grab
 *   point stays under the cursor;
 * - translate in a plane or the view plane: pointer ray / plane intersection;
 * - rotate: angle swept around the pivot in the rotation plane (falls back to a tangent drag when
 *   the plane is seen edge-on);
 * - scale: pointer distance from the pivot on screen, relative to where the drag started.
 */

export type TransformMode = 'translate' | 'rotate' | 'scale';
export type TransformSpace = 'world' | 'local';
export type AxisName = 'x' | 'y' | 'z';
export type DragConstraint =
  { kind: 'axis'; axis: AxisName } | { kind: 'plane'; normal: AxisName } | { kind: 'view' };

export type Vec3 = readonly [number, number, number];
/** three.js component order: x, y, z, w. */
export type Quat = readonly [number, number, number, number];

export interface ViewportSize {
  width: number;
  height: number;
}

export const TRANSLATE_SNAP = 0.1;
export const ROTATE_SNAP = Math.PI / 12;
export const SCALE_SNAP = 0.1;
export const MIN_SCALE_FACTOR = 0.05;

export const AXES: readonly AxisName[] = ['x', 'y', 'z'];

/** |axis . view| above which a translate axis points at the camera and ray math degenerates. */
const AXIS_EDGE_ON = 0.985;
/** |normal . view| below which a translate plane is seen edge-on. */
const PLANE_EDGE_ON = 0.05;
/** |axis . view| below which a rotation plane is seen edge-on and the drag uses the tangent. */
const ROTATE_EDGE_ON = 0.12;
/** Pointer positions closer than this to the pivot don't define a rotation angle. */
const ROTATE_DEAD_ZONE_PX = 8;
/** Edge-on rotation: dragging this many pixels along the ring tangent rotates one radian. */
const TANGENT_RADIUS_PX = 100;
/** Minimum on-screen lever arm for scale drags that start close to the pivot. */
const SCALE_REFERENCE_PX = 40;

const UNIT: Record<AxisName, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

export function axisVector(axis: AxisName): THREE.Vector3 {
  return UNIT[axis].clone();
}

export function constraintForLock(lock: AxisName | null): DragConstraint {
  return lock ? { kind: 'axis', axis: lock } : { kind: 'view' };
}

export function constraintsEqual(a: DragConstraint | null, b: DragConstraint | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind === 'axis' && b.kind === 'axis') return a.axis === b.axis;
  if (a.kind === 'plane' && b.kind === 'plane') return a.normal === b.normal;
  return a.kind === b.kind;
}

/**
 * Orientation of the constraint axes in the scene frame. Scale always works on the object's own
 * axes because MuJoCo sizes are local; translate and rotate follow the chosen space.
 */
export function constraintBasis(
  mode: TransformMode,
  space: TransformSpace,
  rotation: THREE.Quaternion,
): THREE.Quaternion {
  return mode === 'scale' || space === 'local' ? rotation.clone() : new THREE.Quaternion();
}

export function snapStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function wrapAngle(angle: number): number {
  return angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI));
}

/**
 * Parameter `t` of the point on the line `origin + t * direction` closest to the ray, or null when
 * the line is nearly parallel to the ray or the closest point is behind the ray origin.
 */
export function closestAxisParameter(
  ray: THREE.Ray,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
): number | null {
  const b = direction.dot(ray.direction);
  const denominator = 1 - b * b;
  if (denominator < 1e-6) return null;
  const w0 = origin.clone().sub(ray.origin);
  const d = direction.dot(w0);
  const e = ray.direction.dot(w0);
  const lineParameter = (b * e - d) / denominator;
  const rayParameter = (e - b * d) / denominator;
  if (rayParameter < 0 || !Number.isFinite(lineParameter)) return null;
  return lineParameter;
}

/** World units covered by one screen pixel at `point` (used for screen-constant sizes). */
export function worldUnitsPerPixel(
  camera: THREE.Camera,
  point: THREE.Vector3,
  viewportHeight: number,
): number {
  const height = Math.max(1, viewportHeight);
  if (camera instanceof THREE.OrthographicCamera) {
    return (camera.top - camera.bottom) / camera.zoom / height;
  }
  if (camera instanceof THREE.PerspectiveCamera) {
    const cameraPosition = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const depth = Math.max(camera.near, point.clone().sub(cameraPosition).dot(forward));
    const visibleHeight =
      (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * depth) / camera.zoom;
    return visibleHeight / height;
  }
  return 0.01;
}

/** Ray through a pointer given in CSS pixels relative to the viewport's top-left corner. */
export function pointerRay(
  camera: THREE.Camera,
  pointer: THREE.Vector2,
  viewport: ViewportSize,
): THREE.Ray {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(
    new THREE.Vector2((pointer.x / viewport.width) * 2 - 1, -(pointer.y / viewport.height) * 2 + 1),
    camera,
  );
  return raycaster.ray.clone();
}

export function projectToPixels(
  camera: THREE.Camera,
  point: THREE.Vector3,
  viewport: ViewportSize,
): THREE.Vector2 {
  const projected = point.clone().project(camera);
  return new THREE.Vector2(
    ((projected.x + 1) / 2) * viewport.width,
    ((1 - projected.y) / 2) * viewport.height,
  );
}

/** Unit vector from `point` toward the viewer (constant for orthographic cameras). */
export function directionTowardCamera(camera: THREE.Camera, point: THREE.Vector3): THREE.Vector3 {
  if (camera instanceof THREE.OrthographicCamera) {
    return camera.getWorldDirection(new THREE.Vector3()).negate();
  }
  const cameraPosition = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const toward = cameraPosition.sub(point);
  return toward.lengthSq() > 1e-12
    ? toward.normalize()
    : camera.getWorldDirection(new THREE.Vector3()).negate();
}

/** A unit vector perpendicular to `axis`, as close as possible to `preferred`. */
function perpendicularTo(axis: THREE.Vector3, preferred: THREE.Vector3): THREE.Vector3 {
  const candidates = [preferred, UNIT.z, UNIT.x, UNIT.y];
  for (const candidate of candidates) {
    const rejected = candidate.clone().sub(axis.clone().multiplyScalar(candidate.dot(axis)));
    if (rejected.lengthSq() > 1e-6) return rejected.normalize();
  }
  return UNIT.x.clone();
}

export interface TransformFeedback {
  mode: TransformMode;
  constraint: DragConstraint;
  space: TransformSpace;
  snap: boolean;
  /** Pivot at drag start, scene frame. */
  startPivot: Vec3;
  /** Pivot now (moves only when translating), scene frame. */
  pivot: Vec3;
  /** Constraint axis (translate/scale) or rotation axis, scene frame; null for free drags. */
  axis: Vec3 | null;
  /** Orientation of the constraint axes, scene frame. */
  basis: Quat;
  /** Translation since drag start, scene frame. */
  translation: Vec3;
  /** Signed distance along the axis (axis translate) or translation length. */
  distance: number;
  /** Rotation since drag start, radians, right-handed about `axis`. */
  angle: number;
  /** Unit vector in the rotation plane pointing at where the rotation started, scene frame. */
  startDirection: Vec3 | null;
  /** Scale factors along the basis axes. */
  scale: Vec3;
}

export interface TransformSessionOptions {
  mode: TransformMode;
  constraint: DragConstraint;
  space: TransformSpace;
  /** Pivot of the transformed object, scene frame. */
  pivot: THREE.Vector3;
  /** Current orientation of the transformed object, scene frame. */
  rotation: THREE.Quaternion;
  /** Rotation from the scene frame into the three.js world frame. */
  sceneToWorld: THREE.Quaternion;
  camera: THREE.Camera;
  viewport: ViewportSize;
  /** Pointer at drag start, CSS pixels relative to the viewport. */
  pointer: THREE.Vector2;
}

export interface TransformSessionUpdate {
  /** Scene-frame matrix to premultiply onto the object's scene-frame matrix at drag start. */
  delta: THREE.Matrix4;
  feedback: TransformFeedback;
}

export interface TransformSession {
  update: (pointer: THREE.Vector2, snap: boolean) => TransformSessionUpdate;
}

const toVec3 = (vector: THREE.Vector3): Vec3 => [vector.x, vector.y, vector.z];

export function createTransformSession(options: TransformSessionOptions): TransformSession {
  const { mode, constraint, space, camera, viewport } = options;
  const toWorld = options.sceneToWorld.clone();
  const toScene = toWorld.clone().invert();
  const pivotScene = options.pivot.clone();
  const pivotWorld = pivotScene.clone().applyQuaternion(toWorld);
  const basisScene = constraintBasis(mode, space, options.rotation);
  const basisWorld = toWorld.clone().multiply(basisScene);
  const startPointer = options.pointer.clone();
  const towardCamera = directionTowardCamera(camera, pivotWorld);
  const pixel = worldUnitsPerPixel(camera, pivotWorld, viewport.height);
  const centerPx = projectToPixels(camera, pivotWorld, viewport);
  const startRay = pointerRay(camera, startPointer, viewport);
  const worldAxis = (axis: AxisName) => axisVector(axis).applyQuaternion(basisWorld);
  const sceneVector = (vector: THREE.Vector3) => vector.clone().applyQuaternion(toScene);
  /** Screen direction (px) covered by moving `direction` 100 pixels' worth of world units. */
  const screenDirection = (direction: THREE.Vector3) =>
    projectToPixels(
      camera,
      pivotWorld.clone().add(direction.clone().multiplyScalar(pixel * 100)),
      viewport,
    ).sub(centerPx);

  const baseFeedback = {
    mode,
    constraint,
    space,
    startPivot: toVec3(pivotScene),
    basis: [basisScene.x, basisScene.y, basisScene.z, basisScene.w] as Quat,
  };

  if (mode === 'translate') {
    const solve = translateSolver();
    return {
      update: (pointer, snap) => {
        const { translation, distance, axis } = solve(pointer, snap);
        const translationScene = sceneVector(translation);
        return {
          delta: new THREE.Matrix4().makeTranslation(translationScene),
          feedback: {
            ...baseFeedback,
            snap,
            pivot: toVec3(pivotScene.clone().add(translationScene)),
            axis: axis ? toVec3(sceneVector(axis)) : null,
            translation: toVec3(translationScene),
            distance,
            angle: 0,
            startDirection: null,
            scale: [1, 1, 1],
          },
        };
      },
    };
  }

  if (mode === 'rotate') {
    const solve = rotateSolver();
    return {
      update: (pointer, snap) => {
        const { axis, angle, startDirection } = solve(pointer, snap);
        const axisScene = sceneVector(axis).normalize();
        const delta = new THREE.Matrix4()
          .makeTranslation(pivotScene)
          .multiply(new THREE.Matrix4().makeRotationAxis(axisScene, angle))
          .multiply(new THREE.Matrix4().makeTranslation(pivotScene.clone().negate()));
        return {
          delta,
          feedback: {
            ...baseFeedback,
            snap,
            pivot: toVec3(pivotScene),
            axis: toVec3(axisScene),
            translation: [0, 0, 0],
            distance: 0,
            angle,
            startDirection: toVec3(sceneVector(startDirection).normalize()),
            scale: [1, 1, 1],
          },
        };
      },
    };
  }

  const solve = scaleSolver();
  return {
    update: (pointer, snap) => {
      const factors = solve(pointer, snap);
      const rotation = new THREE.Matrix4().makeRotationFromQuaternion(basisScene);
      const delta = new THREE.Matrix4()
        .makeTranslation(pivotScene)
        .multiply(rotation)
        .multiply(new THREE.Matrix4().makeScale(factors.x, factors.y, factors.z))
        .multiply(rotation.clone().invert())
        .multiply(new THREE.Matrix4().makeTranslation(pivotScene.clone().negate()));
      const axis =
        constraint.kind === 'axis' ? axisVector(constraint.axis).applyQuaternion(basisScene) : null;
      return {
        delta,
        feedback: {
          ...baseFeedback,
          snap,
          pivot: toVec3(pivotScene),
          axis: axis ? toVec3(axis) : null,
          translation: [0, 0, 0],
          distance: 0,
          angle: 0,
          startDirection: null,
          scale: toVec3(factors),
        },
      };
    },
  };

  function translateSolver() {
    if (constraint.kind === 'axis') {
      const axis = worldAxis(constraint.axis);
      const screenAxis = screenDirection(axis);
      const startParameter =
        Math.abs(axis.dot(towardCamera)) < AXIS_EDGE_ON
          ? closestAxisParameter(startRay, pivotWorld, axis)
          : null;
      let raw = 0;
      return (pointer: THREE.Vector2, snap: boolean) => {
        if (startParameter !== null) {
          const parameter = closestAxisParameter(
            pointerRay(camera, pointer, viewport),
            pivotWorld,
            axis,
          );
          if (parameter !== null) raw = parameter - startParameter;
        } else if (screenAxis.lengthSq() > 1e-6) {
          // Axis points at the camera: fall back to the axis' (short) screen projection.
          const pointerDelta = pointer.clone().sub(startPointer);
          raw = (pointerDelta.dot(screenAxis) / screenAxis.lengthSq()) * pixel * 100;
        }
        const distance = snap ? snapStep(raw, TRANSLATE_SNAP) : raw;
        return { translation: axis.clone().multiplyScalar(distance), distance, axis };
      };
    }

    const normal = constraint.kind === 'plane' ? worldAxis(constraint.normal) : towardCamera;
    const usable = Math.abs(normal.dot(towardCamera)) > PLANE_EDGE_ON;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      usable ? normal : towardCamera,
      pivotWorld,
    );
    const start = startRay.intersectPlane(plane, new THREE.Vector3()) ?? pivotWorld.clone();
    const basisInverse = basisWorld.clone().invert();
    let raw = new THREE.Vector3();
    return (pointer: THREE.Vector2, snap: boolean) => {
      const hit = pointerRay(camera, pointer, viewport).intersectPlane(plane, new THREE.Vector3());
      if (hit) raw = hit.sub(start);
      const translation = raw.clone();
      if (!usable) translation.sub(normal.clone().multiplyScalar(translation.dot(normal)));
      if (snap) {
        translation.applyQuaternion(basisInverse);
        translation.set(
          snapStep(translation.x, TRANSLATE_SNAP),
          snapStep(translation.y, TRANSLATE_SNAP),
          snapStep(translation.z, TRANSLATE_SNAP),
        );
        translation.applyQuaternion(basisWorld);
      }
      return { translation, distance: translation.length(), axis: null };
    };
  }

  function rotateSolver() {
    const axis =
      constraint.kind === 'axis'
        ? worldAxis(constraint.axis)
        : constraint.kind === 'plane'
          ? worldAxis(constraint.normal)
          : towardCamera.clone();
    const fallbackDirection = perpendicularTo(
      axis,
      new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion),
    );

    if (Math.abs(axis.dot(towardCamera)) <= ROTATE_EDGE_ON) {
      // Edge-on ring: drag along the screen tangent of the ring point nearest the viewer.
      const tangent = axis.clone().cross(towardCamera).normalize();
      const screenTangent = screenDirection(tangent);
      const unitTangent =
        screenTangent.lengthSq() > 1e-6 ? screenTangent.normalize() : new THREE.Vector2(1, 0);
      const startDirection = perpendicularTo(axis, towardCamera);
      return (pointer: THREE.Vector2, snap: boolean) => {
        const total = pointer.clone().sub(startPointer).dot(unitTangent) / TANGENT_RADIUS_PX;
        return { axis, angle: snap ? snapStep(total, ROTATE_SNAP) : total, startDirection };
      };
    }

    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, pivotWorld);
    const deadZone = pixel * ROTATE_DEAD_ZONE_PX;
    const planeVector = (pointer: THREE.Vector2) => {
      const hit = pointerRay(camera, pointer, viewport).intersectPlane(plane, new THREE.Vector3());
      if (!hit) return null;
      const vector = hit.sub(pivotWorld);
      vector.sub(axis.clone().multiplyScalar(vector.dot(axis)));
      return vector.length() > deadZone ? vector : null;
    };
    let reference = planeVector(startPointer)?.normalize() ?? null;
    let lastRaw = 0;
    let total = 0;
    return (pointer: THREE.Vector2, snap: boolean) => {
      const vector = planeVector(pointer);
      if (vector) {
        if (!reference) {
          // Drag started on the pivot: the first point outside the dead zone defines zero.
          reference = vector.clone().normalize();
        } else {
          const raw = Math.atan2(axis.dot(reference.clone().cross(vector)), reference.dot(vector));
          total += wrapAngle(raw - lastRaw);
          lastRaw = raw;
        }
      }
      return {
        axis,
        angle: snap ? snapStep(total, ROTATE_SNAP) : total,
        startDirection: reference ?? fallbackDirection,
      };
    };
  }

  function scaleSolver() {
    const scaledAxes: readonly AxisName[] =
      constraint.kind === 'axis'
        ? [constraint.axis]
        : constraint.kind === 'plane'
          ? AXES.filter((axis) => axis !== constraint.normal)
          : AXES;
    const startOffset = startPointer.clone().sub(centerPx);
    let factorFor: (pointer: THREE.Vector2) => number;
    const screenAxis =
      constraint.kind === 'axis' ? screenDirection(worldAxis(constraint.axis)) : null;
    if (screenAxis && screenAxis.lengthSq() > 1) {
      const unit = screenAxis.normalize();
      const startAlong = startOffset.dot(unit);
      const sign = startAlong >= 0 ? 1 : -1;
      const lever = Math.max(Math.abs(startAlong), SCALE_REFERENCE_PX);
      factorFor = (pointer) =>
        1 + (sign * (pointer.clone().sub(centerPx).dot(unit) - startAlong)) / lever;
    } else {
      const startRadius = startOffset.length();
      const lever = Math.max(startRadius, SCALE_REFERENCE_PX);
      factorFor = (pointer) => 1 + (pointer.clone().sub(centerPx).length() - startRadius) / lever;
    }
    return (pointer: THREE.Vector2, snap: boolean) => {
      const raw = Math.max(MIN_SCALE_FACTOR, factorFor(pointer));
      const factor = snap ? Math.max(SCALE_SNAP, snapStep(raw, SCALE_SNAP)) : raw;
      return new THREE.Vector3(
        scaledAxes.includes('x') ? factor : 1,
        scaledAxes.includes('y') ? factor : 1,
        scaledAxes.includes('z') ? factor : 1,
      );
    };
  }
}

/** True when the delta leaves the object where it started (e.g. a click without a drag). */
export function isIdentityDelta(delta: THREE.Matrix4, epsilon = 1e-9): boolean {
  const identity = new THREE.Matrix4().elements;
  return delta.elements.every((value, index) => Math.abs(value - identity[index]) <= epsilon);
}

const PLANE_LABEL: Record<AxisName, string> = { x: 'YZ', y: 'XZ', z: 'XY' };

export interface TransformReadout {
  title: string;
  value: string;
  detail: string | null;
}

function signed(value: number, digits: number): string {
  const rounded = Number(value.toFixed(digits));
  return `${rounded < 0 ? '-' : '+'}${Math.abs(rounded).toFixed(digits)}`;
}

/** Text for the live readout shown next to the cursor while dragging. */
export function formatTransformReadout(feedback: TransformFeedback): TransformReadout {
  const { constraint } = feedback;
  const axisLabel =
    constraint.kind === 'axis'
      ? `${constraint.axis.toUpperCase()}${feedback.mode !== 'scale' && feedback.space === 'local' ? ' (local)' : ''}`
      : null;
  const vector = (values: Vec3) => values.map((value) => signed(value, 3)).join('  ');

  if (feedback.mode === 'translate') {
    const title =
      constraint.kind === 'axis'
        ? `Move ${axisLabel}`
        : constraint.kind === 'plane'
          ? `Move ${PLANE_LABEL[constraint.normal]} plane`
          : 'Move in view plane';
    return constraint.kind === 'axis'
      ? { title, value: `${signed(feedback.distance, 3)} m`, detail: null }
      : {
          title,
          value: `${feedback.distance.toFixed(3)} m`,
          detail: `Δ ${vector(feedback.translation)}`,
        };
  }

  if (feedback.mode === 'rotate') {
    const degrees = THREE.MathUtils.radToDeg(feedback.angle);
    return {
      title:
        constraint.kind === 'axis'
          ? `Rotate ${axisLabel}`
          : constraint.kind === 'plane'
            ? `Rotate ${constraint.normal.toUpperCase()}`
            : 'Rotate around view',
      value: `${signed(degrees, 1)}°`,
      detail: null,
    };
  }

  const factor =
    constraint.kind === 'axis'
      ? feedback.scale[AXES.indexOf(constraint.axis)]
      : Math.max(...feedback.scale.map((value) => Math.abs(value)));
  return {
    title:
      constraint.kind === 'axis'
        ? `Scale ${axisLabel}`
        : constraint.kind === 'plane'
          ? `Scale ${PLANE_LABEL[constraint.normal]}`
          : 'Scale uniformly',
    value: `×${factor.toFixed(2)}`,
    detail: null,
  };
}

interface HitLike {
  object: THREE.Object3D;
}

/**
 * Event filter for the viewport canvas: transform gizmo handles win over the geometry they sit
 * inside, and handles hidden by the gizmo (parent group invisible) don't react at all.
 */
export function prioritizeTransformGizmoHits<T extends HitLike>(hits: T[]): T[] {
  const gizmo: T[] = [];
  const rest: T[] = [];
  for (const hit of hits) {
    if (!hit.object.userData.transformGizmo) {
      rest.push(hit);
      continue;
    }
    let ancestor = hit.object.parent;
    let visible = true;
    while (ancestor) {
      if (!ancestor.visible) {
        visible = false;
        break;
      }
      ancestor = ancestor.parent;
    }
    if (visible) gizmo.push(hit);
  }
  return gizmo.length ? [...gizmo, ...rest] : rest;
}
