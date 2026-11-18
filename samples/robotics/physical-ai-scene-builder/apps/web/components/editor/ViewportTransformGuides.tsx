// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import {
  formatTransformReadout,
  worldUnitsPerPixel,
  type TransformFeedback,
} from '@/lib/editor/transformInteraction';
import { useEditorStore } from '@/lib/store/editorStore';

import { AXIS_COLORS, GIZMO_SIZE_PX } from './ViewportTransformGizmo';

const GUIDE_LENGTH = 100;
const NEUTRAL = '#dfe3ea';
const ANGLE_FILL = '#ffd25a';
/** Marker for where a move started (screen-sized point at the guide group's origin). */
const START_POINT = new Float32Array([0, 0, 0]);

function guideColor(feedback: TransformFeedback): string {
  const { constraint } = feedback;
  if (constraint.kind === 'axis') return AXIS_COLORS[constraint.axis];
  if (constraint.kind === 'plane') return AXIS_COLORS[constraint.normal];
  return NEUTRAL;
}

function GuideLine({
  points,
  color,
  opacity = 0.9,
  dashed = false,
}: {
  points: readonly THREE.Vector3[];
  color: string;
  opacity?: number;
  dashed?: boolean;
}) {
  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints([...points]);
    const material = dashed
      ? new THREE.LineDashedMaterial({ color, dashSize: 0.03, gapSize: 0.02 })
      : new THREE.LineBasicMaterial({ color });
    material.transparent = true;
    material.opacity = opacity;
    material.depthTest = false;
    material.depthWrite = false;
    material.toneMapped = false;
    material.fog = false;
    const object = new THREE.Line(geometry, material);
    if (dashed) object.computeLineDistances();
    object.renderOrder = 999;
    object.raycast = () => undefined;
    return object;
  }, [points, color, opacity, dashed]);
  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [line],
  );
  return <primitive object={line} />;
}

/**
 * Constraint line through `origin` along `direction` (scene frame). Its ends are trimmed every frame
 * to stay in front of the camera, since segments crossing behind the viewer don't rasterize
 * reliably on every GPU.
 */
function AxisGuide({
  origin,
  direction,
  color,
}: {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  color: string;
}) {
  const camera = useThree((state) => state.camera);
  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.75,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    const object = new THREE.Line(geometry, material);
    object.renderOrder = 999;
    object.frustumCulled = false;
    object.raycast = () => undefined;
    return object;
  }, [color]);
  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [line],
  );

  useFrame(() => {
    const parent = line.parent;
    if (!parent) return;
    const worldOrigin = parent.localToWorld(origin.clone());
    const worldDirection = parent
      .localToWorld(origin.clone().add(direction))
      .sub(worldOrigin)
      .normalize();
    const cameraPosition = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const depth = worldOrigin.clone().sub(cameraPosition).dot(forward);
    const minimumDepth = Math.max(depth * 0.05, 0.02);
    const reach = (sign: 1 | -1) => {
      const approach = sign * worldDirection.dot(forward);
      return approach < -1e-6
        ? Math.min(GUIDE_LENGTH, (depth - minimumDepth) / -approach)
        : GUIDE_LENGTH;
    };
    const positions = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const ahead = origin.clone().addScaledVector(direction, Math.max(0, reach(1)));
    const behind = origin.clone().addScaledVector(direction, -Math.max(0, reach(-1)));
    positions.setXYZ(0, behind.x, behind.y, behind.z);
    positions.setXYZ(1, ahead.x, ahead.y, ahead.z);
    positions.needsUpdate = true;
  });

  return <primitive object={line} />;
}

/** Ring, start/current spokes and a filled sector showing the angle swept so far. */
function RotationGuide({ feedback, color }: { feedback: TransformFeedback; color: string }) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const groupRef = useRef<THREE.Group>(null);
  const { angle } = feedback;

  const orientation = useMemo(() => {
    const axis = new THREE.Vector3(...(feedback.axis ?? [0, 0, 1])).normalize();
    const start = new THREE.Vector3(...(feedback.startDirection ?? [1, 0, 0])).normalize();
    const side = axis.clone().cross(start).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(start, side, axis),
    );
  }, [feedback.axis, feedback.startDirection]);

  const sector = useMemo(() => {
    const sweep = THREE.MathUtils.clamp(angle, -2 * Math.PI, 2 * Math.PI);
    return new THREE.CircleGeometry(1, 96, 0, sweep);
  }, [angle]);
  useEffect(() => () => sector.dispose(), [sector]);

  const ring = useMemo(() => {
    const points: THREE.Vector3[] = [];
    for (let index = 0; index <= 128; index += 1) {
      const theta = (index / 128) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(theta), Math.sin(theta), 0));
    }
    return points;
  }, []);
  const startSpoke = useMemo(() => [new THREE.Vector3(), new THREE.Vector3(1, 0, 0)], []);
  const currentSpoke = useMemo(
    () => [new THREE.Vector3(), new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0)],
    [angle],
  );

  useFrame(() => {
    const group = groupRef.current;
    if (!group?.parent) return;
    const world = group.parent.localToWorld(group.position.clone());
    group.scale.setScalar(worldUnitsPerPixel(camera, world, size.height) * GIZMO_SIZE_PX);
  });

  return (
    <group ref={groupRef} position={feedback.pivot} quaternion={orientation}>
      <GuideLine points={ring} color={color} opacity={0.55} />
      <GuideLine points={startSpoke} color={NEUTRAL} opacity={0.7} dashed />
      <GuideLine points={currentSpoke} color={ANGLE_FILL} />
      <mesh geometry={sector} renderOrder={998} raycast={() => undefined}>
        <meshBasicMaterial
          color={ANGLE_FILL}
          transparent
          opacity={0.22}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
          fog={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

/**
 * Drag guides in the MuJoCo scene frame (render inside the Z-up root group): the constraint line
 * for axis moves and scales, a dashed offset from the start position for free moves, and the
 * swept angle for rotations.
 */
export function TransformGuides() {
  const feedback = useEditorStore((state) => state.transformFeedback);

  const lines = useMemo(() => {
    if (!feedback) return null;
    const start = new THREE.Vector3(...feedback.startPivot);
    const axis = feedback.axis ? new THREE.Vector3(...feedback.axis) : null;
    return {
      start,
      current: new THREE.Vector3(...feedback.pivot),
      axis: axis?.normalize() ?? null,
    };
  }, [feedback]);

  if (!feedback || !lines) return null;
  const color = guideColor(feedback);

  if (feedback.mode === 'rotate') return <RotationGuide feedback={feedback} color={color} />;

  return (
    <group>
      {lines.axis && <AxisGuide origin={lines.start} direction={lines.axis} color={color} />}
      {feedback.mode === 'translate' && (
        <>
          <GuideLine points={[lines.start, lines.current]} color={NEUTRAL} opacity={0.8} dashed />
          <points position={lines.start} renderOrder={999} raycast={() => undefined}>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[START_POINT, 3]} />
            </bufferGeometry>
            <pointsMaterial
              color={NEUTRAL}
              size={7}
              sizeAttenuation={false}
              depthTest={false}
              toneMapped={false}
              fog={false}
            />
          </points>
        </>
      )}
    </group>
  );
}

/**
 * Live readout that follows the cursor while a transform drag is in progress (HTML overlay; render
 * inside a positioned container).
 */
export function TransformReadoutOverlay() {
  const feedback = useEditorStore((state) => state.transformFeedback);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const panel = panelRef.current;
      const container = panel?.offsetParent;
      if (!panel || !(container instanceof HTMLElement)) return;
      const bounds = container.getBoundingClientRect();
      const x = Math.min(event.clientX - bounds.left + 18, bounds.width - panel.offsetWidth - 8);
      const y = Math.min(event.clientY - bounds.top + 18, bounds.height - panel.offsetHeight - 8);
      panel.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
    };
    window.addEventListener('pointermove', onPointerMove);
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, []);

  const readout = feedback ? formatTransformReadout(feedback) : null;
  const color = feedback ? guideColor(feedback) : NEUTRAL;

  return (
    <div
      ref={panelRef}
      className="pointer-events-none absolute top-0 left-0 z-20 border border-border-strong bg-surface/95 px-2.5 py-1.5 font-mono text-[11px] shadow-lg"
      style={{ borderLeft: `3px solid ${color}`, visibility: readout ? 'visible' : 'hidden' }}
      role="status"
      aria-live="off"
      aria-label="Transform readout"
    >
      {readout && feedback && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-muted">{readout.title}</span>
            <span className="font-medium text-foreground">{readout.value}</span>
            {feedback.snap && (
              <span className="border border-accent/50 px-1 text-[9px] uppercase text-accent">
                snap
              </span>
            )}
          </div>
          {readout.detail && <div className="text-muted">{readout.detail}</div>}
          <div className="mt-0.5 text-[10px] text-muted/80">
            X/Y/Z axis · Ctrl snap · Esc cancel
          </div>
        </>
      )}
    </div>
  );
}
