// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { usePhysics } from '@mujoco-studio/mujoco';
import { MUJOCO_ROOT_ROTATION_X } from '@mujoco-studio/scene';
import type { LightNode } from '@mujoco-studio/types';
import { LightType } from '@mujoco-studio/types';
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

import { getNodeAttributes } from '@/lib/editor/document';
import { installMujocoSpotLights, mujocoSpotSettings } from '@/lib/editor/mujocoSpotLights';
import { useEditorStore } from '@/lib/store/editorStore';

// Before any material compiles: parity spot lights need MuJoCo's cos^exponent falloff.
installMujocoSpotLights();

function vectorAttribute(
  value: string | undefined,
  fallback: readonly [number, number, number],
): [number, number, number] {
  const values = value?.trim().split(/\s+/).map(Number) ?? [];
  return values.length === 3 && values.every(Number.isFinite)
    ? [values[0], values[1], values[2]]
    : [fallback[0], fallback[1], fallback[2]];
}

function colorAttribute(value: string | undefined, fallback: string): THREE.Color {
  const [r, g, b] = vectorAttribute(value, [1, 1, 1]);
  return value ? new THREE.Color(r, g, b) : new THREE.Color(fallback);
}

function boolAttribute(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

function lightIntensity(value: string | undefined, mujocoParity: boolean): number {
  // MuJoCo shading has no 1/pi Lambert factor; scaling by pi matches it (color carries the RGB).
  if (mujocoParity) return Math.PI;
  const [r, g, b] = vectorAttribute(value, [1, 1, 1]);
  return Math.max(r, g, b) * 2;
}

/**
 * three.js spot and directional lights start at (0, 1, 0), which inside the MuJoCo-frame group is
 * 1 m along MuJoCo +Y: the light sat beside its group and aimed at its target from there (about 45
 * degrees off for a light pointing down). The group carries the light's position.
 */
const LIGHT_AT_GROUP_ORIGIN: [number, number, number] = [0, 0, 0];

function authoredLightType(node: LightNode): 'directional' | 'point' | 'spot' {
  if (node.lightType === LightType.Point) return 'point';
  if (node.lightType === LightType.Spot) return 'spot';
  return 'directional';
}

function AuthoredLight({
  node,
  selected,
  showHelper,
  mujocoParity,
}: {
  node: LightNode;
  selected: boolean;
  showHelper: boolean;
  mujocoParity: boolean;
}) {
  const { getSimulation } = usePhysics();
  const groupRef = useRef<THREE.Group>(null);
  const targetRef = useRef<THREE.Object3D>(null);
  const lightRef = useRef<THREE.Light>(null);
  const xml = useEditorStore((state) => state.xml);
  const attributes = getNodeAttributes(xml, node);
  const type = authoredLightType(node);
  const direction = vectorAttribute(attributes.dir, [0, 0, -1]);
  const target = new THREE.Vector3(...direction);
  // MuJoCo's default light diffuse is 0.7 gray.
  const color =
    mujocoParity && !attributes.diffuse
      ? new THREE.Color(0.7, 0.7, 0.7)
      : colorAttribute(attributes.diffuse, '#ffffff');

  useEffect(() => {
    if (lightRef.current && targetRef.current && 'target' in lightRef.current) {
      (lightRef.current as THREE.DirectionalLight | THREE.SpotLight).target = targetRef.current;
    }
  }, []);

  useFrame(() => {
    const simulation = getSimulation();
    const group = groupRef.current;
    if (!group || !simulation) return;
    const position = simulation.lightPosition(node.mjIndex);
    const currentDirection = simulation.lightDirection(node.mjIndex);
    group.position.set(position[0], position[1], position[2]);
    // The target is a child of the light's group, so it sits one direction vector from the light.
    // Adding the light position here again aimed lights away from the scene.
    targetRef.current?.position.set(currentDirection[0], currentDirection[1], currentDirection[2]);
  });

  return (
    <group ref={groupRef} userData={{ authoredLight: node.id }}>
      {type === 'point' ? (
        <pointLight
          ref={lightRef as React.RefObject<THREE.PointLight>}
          color={color}
          intensity={lightIntensity(attributes.diffuse, mujocoParity)}
          decay={mujocoParity ? 0 : 2}
          castShadow={boolAttribute(attributes.castshadow)}
        />
      ) : type === 'spot' ? (
        <spotLight
          ref={lightRef as React.RefObject<THREE.SpotLight>}
          position={LIGHT_AT_GROUP_ORIGIN}
          color={color}
          intensity={lightIntensity(attributes.diffuse, mujocoParity)}
          {...(mujocoParity
            ? mujocoSpotSettings(node.cutoff, node.exponent)
            : {
                angle: ((Number(attributes.cutoff) || 45) * Math.PI) / 180,
                penumbra: Math.min(1, (Number(attributes.exponent) || 0) / 100),
                decay: 2,
              })}
          castShadow={boolAttribute(attributes.castshadow)}
        />
      ) : (
        <directionalLight
          ref={lightRef as React.RefObject<THREE.DirectionalLight>}
          position={LIGHT_AT_GROUP_ORIGIN}
          color={color}
          intensity={lightIntensity(attributes.diffuse, mujocoParity)}
          castShadow={boolAttribute(attributes.castshadow)}
        />
      )}
      <object3D ref={targetRef} userData={{ authoredLightTarget: node.id }} position={target} />
      {showHelper && (
        <mesh userData={{ authoredLight: node.id }} raycast={() => null}>
          <sphereGeometry args={[selected ? 0.08 : 0.055, 12, 8]} />
          <meshBasicMaterial color={selected ? '#ff8a3d' : '#f6c85f'} />
        </mesh>
      )}
    </group>
  );
}

/** `mujocoParity` lights the camera preview the way native MuJoCo renders recorded images. */
export function AuthoredSceneLighting({
  showHelpers = true,
  mujocoParity = false,
}: { showHelpers?: boolean; mujocoParity?: boolean } = {}) {
  const { graph } = usePhysics();
  const selectedIds = useEditorStore((state) => state.selectedIds);
  if (!graph) return null;
  const lights = graph.order
    .map((id) => graph.nodes[id])
    .filter((node): node is LightNode => node.kind === 'light');
  return (
    <group rotation={[MUJOCO_ROOT_ROTATION_X, 0, 0]}>
      {lights.map((node) => (
        <AuthoredLight
          key={node.id}
          node={node}
          selected={showHelpers && selectedIds.includes(node.id)}
          showHelper={showHelpers}
          mujocoParity={mujocoParity}
        />
      ))}
    </group>
  );
}
