// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { usePhysics } from '@mujoco-studio/mujoco';
import { MUJOCO_ROOT_ROTATION_X } from '@mujoco-studio/scene';
import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

import { THREE_TO_MUJOCO } from '@/lib/editor/runtimeTransforms';
import {
  collisionClearance,
  rotationForNormal,
  sceneGeomBoxes,
  supportExtent,
  threeQuaternionFromMujoco,
} from '@/lib/editor/viewportGeometry';
import type { DraggedAssetPreview, PlacementCandidate } from '@/lib/editor/viewportTypes';

export function PlacementDropSurface({
  asset,
  onPreview,
  onDrop,
}: {
  asset: DraggedAssetPreview | null;
  onPreview: (candidate: PlacementCandidate | null) => void;
  onDrop: (candidate: PlacementCandidate) => void;
}) {
  const { camera, gl, scene } = useThree();
  const { graph } = usePhysics();
  const raycaster = useRef(new THREE.Raycaster());

  useEffect(() => {
    if (!asset) {
      onPreview(null);
      return;
    }

    const element = gl.domElement;
    const dimensions = asset.dimensions;
    const resolveCandidate = (clientX: number, clientY: number): PlacementCandidate | null => {
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return null;
      const pointer = new THREE.Vector2(
        ((clientX - bounds.left) / bounds.width) * 2 - 1,
        -((clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      raycaster.current.setFromCamera(pointer, camera);

      const hit = raycaster.current.intersectObjects(scene.children, true).find((intersection) => {
        if (
          !(intersection.object instanceof THREE.Mesh) ||
          intersection.object.userData.placementPreview
        ) {
          return false;
        }
        const nodeId = intersection.object.userData.nodeId;
        return typeof nodeId === 'string' && graph?.nodes[nodeId]?.kind === 'geom';
      });

      const worldPoint = new THREE.Vector3();
      const worldNormal = new THREE.Vector3(0, 1, 0);
      if (hit) {
        worldPoint.copy(hit.point);
        if (hit.face) {
          worldNormal
            .copy(hit.face.normal)
            .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
            .normalize();
        }
      } else if (
        !raycaster.current.ray.intersectPlane(new THREE.Plane(worldNormal, 0), worldPoint)
      ) {
        return null;
      }

      const localPoint = worldPoint.applyQuaternion(THREE_TO_MUJOCO);
      const localNormal = worldNormal.applyQuaternion(THREE_TO_MUJOCO).normalize();
      const rotation = rotationForNormal(localNormal);
      const localRotation = threeQuaternionFromMujoco(rotation);
      const supportNormal = localNormal.clone().applyQuaternion(localRotation.clone().invert());
      localPoint.addScaledVector(localNormal, supportExtent(supportNormal, dimensions) + 0.002);

      const boxes = sceneGeomBoxes(scene, graph);
      for (let attempt = 0; attempt < 8; attempt++) {
        const clearance = collisionClearance(localPoint, dimensions, boxes);
        if (!clearance) break;
        localPoint.addScaledVector(localNormal, clearance);
      }

      return {
        assetId: asset.id,
        position: [localPoint.x, localPoint.y, localPoint.z],
        rotation,
        normal: [localNormal.x, localNormal.y, localNormal.z],
      };
    };

    const handleDragOver = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      onPreview(resolveCandidate(event.clientX, event.clientY));
    };
    const handleDrop = (event: DragEvent) => {
      event.preventDefault();
      const candidate = resolveCandidate(event.clientX, event.clientY);
      onPreview(null);
      if (candidate) onDrop(candidate);
    };
    const handleDragLeave = () => onPreview(null);

    element.addEventListener('dragover', handleDragOver);
    element.addEventListener('drop', handleDrop);
    element.addEventListener('dragleave', handleDragLeave);
    return () => {
      element.removeEventListener('dragover', handleDragOver);
      element.removeEventListener('drop', handleDrop);
      element.removeEventListener('dragleave', handleDragLeave);
    };
  }, [asset, camera, gl, graph, onDrop, onPreview, scene]);

  return null;
}

export function PlacementPreview({
  candidate,
  dimensions,
}: {
  candidate: PlacementCandidate;
  dimensions: readonly [number, number, number];
}) {
  return (
    <group rotation={[MUJOCO_ROOT_ROTATION_X, 0, 0]} userData={{ placementPreview: true }}>
      <group
        position={candidate.position}
        quaternion={threeQuaternionFromMujoco(candidate.rotation)}
        userData={{ placementPreview: true }}
      >
        <mesh userData={{ placementPreview: true }} raycast={() => null}>
          <boxGeometry args={[dimensions[0], dimensions[1], dimensions[2]]} />
          <meshBasicMaterial color="#4cc4e0" transparent opacity={0.24} depthWrite={false} />
        </mesh>
        <mesh userData={{ placementPreview: true }} raycast={() => null}>
          <boxGeometry args={[dimensions[0], dimensions[1], dimensions[2]]} />
          <meshBasicMaterial color="#a8edf5" transparent opacity={0.8} wireframe />
        </mesh>
      </group>
    </group>
  );
}
