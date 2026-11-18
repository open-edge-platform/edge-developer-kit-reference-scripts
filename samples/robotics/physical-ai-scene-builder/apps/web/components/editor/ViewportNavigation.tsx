// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { usePhysics } from '@mujoco-studio/mujoco';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';

import type { ViewportCameraPose } from '@/lib/editor/runtimeTransforms';
import { focusBoundsForSelection } from '@/lib/editor/viewportGeometry';
import type { FocusRequest, OrbitControlsLike } from '@/lib/editor/viewportTypes';

export function CameraPoseTracker({
  cameraPoseRef,
}: {
  cameraPoseRef: React.MutableRefObject<ViewportCameraPose | null>;
}) {
  const { camera, controls } = useThree();
  const fallbackTarget = useMemo(() => new THREE.Vector3(0, 0.35, 0), []);

  useFrame(() => {
    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    const orbitControls = controls as unknown as { target?: THREE.Vector3 } | null;
    const target = orbitControls?.target ?? fallbackTarget;
    cameraPoseRef.current = {
      position: [
        perspectiveCamera.position.x,
        perspectiveCamera.position.y,
        perspectiveCamera.position.z,
      ],
      target: [target.x, target.y, target.z],
      fovy: perspectiveCamera.fov,
    };
  });

  return null;
}

export function ViewportNavigation({
  focusRequestRef,
}: {
  focusRequestRef: React.MutableRefObject<FocusRequest | null>;
}) {
  const { camera, controls, scene } = useThree();
  const { graph } = usePhysics();

  useFrame(() => {
    const request = focusRequestRef.current;
    if (!request) return;
    if (!graph || !controls || !(camera instanceof THREE.PerspectiveCamera)) return;

    const bounds = focusBoundsForSelection(scene, graph, request.ids);
    focusRequestRef.current = null;
    if (!bounds) return;

    const orbitControls = controls as unknown as OrbitControlsLike;
    if (!orbitControls.target || typeof orbitControls.update !== 'function') return;

    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 0.08);
    const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov) * 0.5;
    const aspect = Math.max(camera.aspect, 0.1);
    const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * aspect);
    const limitingHalfFov = Math.max(Math.min(verticalHalfFov, horizontalHalfFov), 0.05);
    const distance = Math.max((radius / Math.sin(limitingHalfFov)) * 1.25, radius * 2, 0.35);
    const direction = camera.position.clone().sub(orbitControls.target);
    if (direction.lengthSq() < 1e-6) direction.set(1, 1, 1);
    direction.normalize();

    orbitControls.target.copy(center);
    camera.position.copy(center).addScaledVector(direction, distance);
    orbitControls.update();
  });

  return null;
}
