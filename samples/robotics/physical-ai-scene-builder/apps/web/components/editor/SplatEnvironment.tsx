// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { SPLAT_BACKDROP_BODY, splatFormatOf } from '@mujoco-studio/types';
import { usePhysics } from '@mujoco-studio/mujoco';

import { backdropDragPreview } from '@/lib/editor/backdropDragPreview';
import {
  bodyTransform,
  cachedRemovedSplatIndices,
  cleanupActive,
  keptByCropAndOpacity,
  type SplatCleanup,
} from '@/lib/editor/splatCleanup';
import { readSplatPoints } from '@/lib/editor/splatPoints';
import { type QuaternionTuple, type SplatPoint, type Vec3Tuple } from '@/lib/editor/splatCollision';

const SPARK_DISPOSE_RACE_MESSAGES = new Set(['Worker terminate', 'No target', 'No renderer']);
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason instanceof Error && SPARK_DISPOSE_RACE_MESSAGES.has(event.reason.message)) {
      event.preventDefault();
    }
  });
}

export type SplatEnvironmentStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface SplatEnvironmentProps {
  src?: string;
  /**
   * Static MJCF body whose runtime pose places the splat: mesh matrix = bodyWorld * R * S(scale).
   * The body is the single pose source of truth (shared with the native workers).
   */
  bodyName?: string;
  /** Calibration scale from raw PLY coordinates to the body frame. */
  scale?: number;
  /** Calibration rotation `R` from raw PLY coordinates to the body frame ([w, x, y, z]). */
  rotation?: QuaternionTuple;
  /** Translation used only while the body is missing (before the backdrop is merged). */
  fallbackOrigin?: Vec3Tuple | null;
  /** Parts of the scan left out (splatCleanup.ts), as the native compositor leaves them out. */
  cleanup?: SplatCleanup;
  onStatusChange?: (status: SplatEnvironmentStatus) => void;
  /**
   * Visible splats in raw PLY coordinates (Spark applies no axis flip), read at full precision.
   */
  onLoad?: (points: SplatPoint[]) => void;
  onError?: (error: Error) => void;
}

/**
 * Spark can reject a sort that races a dispose (worker terminated, renderer gone). Without this, a
 * rejected `driveSort` leaves `sorting` stuck true and the renderer never sorts again.
 */
function patchSparkRendererResilience(SparkRendererCtor: new (...args: never[]) => SparkRenderer) {
  const proto = SparkRendererCtor.prototype as unknown as {
    driveSort?: () => Promise<void>;
    __driveSortPatched?: boolean;
  };
  if (proto.__driveSortPatched || !proto.driveSort) return;
  const originalDriveSort = proto.driveSort;
  proto.driveSort = async function patchedDriveSort(this: SparkRenderer) {
    try {
      await originalDriveSort.call(this);
    } catch (error) {
      this.sorting = false;
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[SplatEnvironment] recovered from a SparkRenderer sort failure', error);
      }
    }
  };
  proto.__driveSortPatched = true;
}

/** Decoded points per splat URL, shared by the viewport, camera preview, and captures. */
const pointsByUrl = new Map<string, Promise<SplatPoint[] | null>>();
function splatPointsFor(url: string, blob: Blob): Promise<SplatPoint[] | null> {
  let points = pointsByUrl.get(url);
  if (!points) {
    points = readSplatPoints(blob).catch(() => null);
    pointsByUrl.set(url, points);
    // Blob URLs are revoked when the splat is replaced; keep only recent entries.
    while (pointsByUrl.size > 4) pointsByUrl.delete(pointsByUrl.keys().next().value as string);
  }
  return points;
}

type EditableSplats = NonNullable<SplatMesh['packedSplats']>;

/**
 * Hides (zero opacity) the Gaussians `cleanup` removes, after restoring the ones hidden before.
 * `hidden` remembers their original opacities. Returns how many are hidden.
 */
function applyCleanup(
  mesh: SplatMesh,
  points: readonly SplatPoint[],
  cleanup: SplatCleanup | undefined,
  scale: number,
  rotation: QuaternionTuple,
  hidden: Map<number, number>,
): number {
  const splats = (mesh.packedSplats ?? mesh.extSplats) as EditableSplats | undefined;
  if (!splats) return 0;
  let changed = false;
  if (hidden.size) {
    splats.forEachSplat((index, center, scales, quaternion, _opacity, color) => {
      const original = hidden.get(index);
      if (original !== undefined)
        splats.setSplat(index, center, scales, quaternion, original, color);
    });
    hidden.clear();
    changed = true;
  }
  if (cleanupActive(cleanup)) {
    const removed = cachedRemovedSplatIndices(points, cleanup, scale, rotation);
    const toBody = bodyTransform(scale, rotation);
    splats.forEachSplat((index, center, scales, quaternion, opacity, color) => {
      if (opacity <= 0) return;
      if (
        removed?.has(index) ||
        !keptByCropAndOpacity(cleanup, toBody, center.x, center.y, center.z, opacity)
      ) {
        hidden.set(index, opacity);
        splats.setSplat(index, center, scales, quaternion, 0, color);
      }
    });
    changed = true;
  }
  if (changed) splats.needsUpdate = true;
  return hidden.size;
}

/** Renders one PLY or SPZ Gaussian splat at the runtime pose of its MJCF backdrop body. */
export function SplatEnvironment({
  src,
  bodyName = SPLAT_BACKDROP_BODY,
  scale = 1,
  rotation,
  fallbackOrigin = null,
  cleanup,
  onStatusChange,
  onLoad,
  onError,
}: SplatEnvironmentProps) {
  const groupRef = useRef<THREE.Group>(null);
  const { gl, invalidate } = useThree();
  const { graph, getSimulation } = usePhysics();
  const meshRef = useRef<SplatMesh | null>(null);
  const pointsRef = useRef<SplatPoint[]>([]);
  const hiddenRef = useRef(new Map<number, number>());
  const [loadedVersion, setLoadedVersion] = useState(0);
  const callbacksRef = useRef({ onStatusChange, onLoad, onError });
  const scratch = useRef({
    matrix: new THREE.Matrix4(),
    calibration: new THREE.Matrix4(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
  });
  const [rw = 1, rx = 0, ry = 0, rz = 0] = rotation ?? [];

  useLayoutEffect(() => {
    callbacksRef.current = { onStatusChange, onLoad, onError };
  });

  const body = useMemo(() => {
    if (!graph) return null;
    for (const id of graph.order) {
      const node = graph.nodes[id];
      if (node?.kind === 'body' && node.name === bodyName && node.mjIndex > 0) return node;
    }
    return null;
  }, [bodyName, graph]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const { matrix, calibration, quaternion, scale: scaleVector } = scratch.current;
    const simulation = getSimulation();
    if (body && simulation) {
      const p = body.mjIndex * 3;
      const r = body.mjIndex * 9;
      const positions = simulation.bodyPositions;
      const rotations = simulation.bodyRotations;
      // prettier-ignore
      matrix.set(
        rotations[r], rotations[r + 1], rotations[r + 2], positions[p],
        rotations[r + 3], rotations[r + 4], rotations[r + 5], positions[p + 1],
        rotations[r + 6], rotations[r + 7], rotations[r + 8], positions[p + 2],
        0, 0, 0, 1,
      );
      if (backdropDragPreview.nodeId === body.id) matrix.premultiply(backdropDragPreview.delta);
    } else {
      // No body: never keep a stale pose; place the scan at its aligned origin with an
      // identity body rotation (the calibration rotation still applies below).
      const origin = fallbackOrigin ?? [0, 0, 0];
      matrix.makeTranslation(origin[0], origin[1], origin[2]);
    }
    // mesh = bodyWorld * R * S(scale); THREE.Quaternion takes (x, y, z, w).
    quaternion.set(rx, ry, rz, rw).normalize();
    matrix.multiply(calibration.makeRotationFromQuaternion(quaternion));
    matrix.scale(scaleVector.setScalar(scale > 0 ? scale : 1));
    if (!mesh.matrix.equals(matrix)) {
      mesh.matrix.copy(matrix);
      mesh.matrixWorldNeedsUpdate = true;
      invalidate();
    }
  });

  useEffect(() => {
    const group = groupRef.current;
    if (!src || !group) {
      callbacksRef.current.onStatusChange?.('idle');
      return;
    }

    const splatGroup = group;
    const url = src;
    let disposed = false;
    let spark: SparkRenderer | undefined;
    let mesh: SplatMesh | undefined;

    async function load() {
      callbacksRef.current.onStatusChange?.('loading');
      try {
        const { SparkRenderer, SplatMesh, SplatFileType } = await import('@sparkjsdev/spark');
        if (disposed) return;

        // A blob URL has no extension for Spark to go by, so sniff PLY vs SPZ from the bytes.
        const blob = await fetch(url).then((response) => response.blob());
        if (disposed) return;
        const format = splatFormatOf(new Uint8Array(await blob.slice(0, 2).arrayBuffer()));
        // Parse the splat (collision and cleanup) while Spark decodes it for rendering.
        const precise = splatPointsFor(url, blob);
        patchSparkRendererResilience(SparkRenderer);
        spark = new SparkRenderer({ renderer: gl, onDirty: invalidate });
        mesh = new SplatMesh({
          url,
          fileType: format === 'spz' ? SplatFileType.SPZ : SplatFileType.PLY,
        });
        mesh.name = 'GaussianSplatMesh';
        // The pose is written as a full matrix every frame from the backdrop body.
        mesh.matrixAutoUpdate = false;
        mesh.visible = false;
        splatGroup.add(spark);
        splatGroup.add(mesh);

        await mesh.initialized;
        const points = await precise;
        if (disposed) return;
        if (!points) throw new Error('The splat could not be decoded for collision geometry.');
        pointsRef.current = points;
        hiddenRef.current = new Map();
        meshRef.current = mesh;
        setLoadedVersion((version) => version + 1);
        mesh.visible = true;
        callbacksRef.current.onStatusChange?.('ready');
        callbacksRef.current.onLoad?.(points);
        invalidate();
      } catch (err) {
        if (disposed) return;
        const error = err instanceof Error ? err : new Error(String(err));
        callbacksRef.current.onStatusChange?.('error');
        callbacksRef.current.onError?.(error);
      }
    }

    load();

    return () => {
      disposed = true;
      meshRef.current = null;
      pointsRef.current = [];
      if (mesh) {
        splatGroup.remove(mesh);
        mesh.dispose();
      }
      if (spark) {
        splatGroup.remove(spark);
        spark.dispose();
      }
    };
  }, [src, gl, invalidate]);

  // Re-applied when the cleanup or calibration changes, without reloading the splat.
  const cleanupKey = JSON.stringify(cleanup ?? null);
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    applyCleanup(
      mesh,
      pointsRef.current,
      cleanupKey === 'null' ? undefined : (JSON.parse(cleanupKey) as SplatCleanup),
      scale > 0 ? scale : 1,
      [rw, rx, ry, rz],
      hiddenRef.current,
    );
    invalidate();
  }, [cleanupKey, scale, rw, rx, ry, rz, loadedVersion, invalidate]);

  return <group ref={groupRef} />;
}
