// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { usePhysics } from '@mujoco-studio/mujoco';
import { MUJOCO_ROOT_ROTATION_X } from '@mujoco-studio/scene';
import { Html, Line } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import { visibleGeomBoundsForSelection } from '@/lib/editor/viewportGeometry';
import {
  type ExtraObjectSettings,
  type RangeFields,
  useGenerationSettings,
} from '@/lib/generation/generationSettings';
import {
  moveZone,
  previewSamples,
  rangesFromZone,
  resizeZone,
  yawFromRange,
  zoneFromRanges,
  zoneColor,
  zoneSizeLabel,
  type ZoneRect,
} from '@/lib/generation/randomizationZone';

/** What the zone editor needs: whose zone, where the object is authored, and whether it is locked. */
export interface GenerationZoneTarget {
  /** Per-scene key of the Generate settings (`useGenerationSettings`). */
  sceneKey: string;
  body: string;
  /** Authored world position of the object, in MuJoCo metres (z up). */
  origin: readonly [number, number, number];
  disabled: boolean;
  /** Authored positions of the other movable bodies, for extra randomized objects. */
  bodyOrigins: Readonly<Record<string, readonly [number, number, number]>>;
}

const LOCKED_COLOR = '#64748b';
const PREVIEW_COUNT = 8;
/** Handle radius as a fraction of the camera distance, so handles keep the same screen size. */
const HANDLE_SCREEN_SCALE = 0.007;
const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;

type Drag = { kind: 'move' } | { kind: 'corner'; corner: readonly [-1 | 1, -1 | 1] };

interface Footprint {
  width: number;
  depth: number;
  bottom: number;
  /** MuJoCo x/y of the visible centre relative to the body origin (meshes may be off-centre). */
  center: [number, number];
}

/** Rendered footprint of the object (MuJoCo x/y size and lowest z), from its visible geoms. */
function useFootprint(body: string, origin: readonly [number, number, number]): Footprint {
  const { graph } = usePhysics();
  const scene = useThree((state) => state.scene);
  const [footprint, setFootprint] = useState<Footprint | null>(null);
  const [originX, originY] = origin;
  useEffect(() => {
    if (!graph) return;
    const id = graph.order.find((nodeId) => {
      const node = graph.nodes[nodeId];
      return node?.kind === 'body' && node.name === body;
    });
    if (!id) return;
    // Geom meshes position themselves in an effect; measure on the next frame.
    const frame = requestAnimationFrame(() => {
      const bounds = visibleGeomBoundsForSelection(scene, graph, [id]);
      if (!bounds) return;
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      // three.js (x, y, z) is MuJoCo (x, z, -y).
      setFootprint({
        width: size.x,
        depth: size.z,
        bottom: bounds.min.y,
        center: [center.x - originX, -center.z - originY],
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [body, graph, originX, originY, scene]);
  return footprint ?? { width: 0.04, depth: 0.04, bottom: origin[2], center: [0, 0] };
}

function rectPoints(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  z: number,
): [number, number, number][] {
  return [
    [minX, minY, z],
    [maxX, minY, z],
    [maxX, maxY, z],
    [minX, maxY, z],
    [minX, minY, z],
  ];
}

/** A drag handle that keeps a constant on-screen size and always draws on top. */
function Handle({
  position,
  color,
  cursor,
  onDragStart,
}: {
  position: [number, number, number];
  color: string;
  cursor: string;
  onDragStart: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const world = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    if (!mesh.current) return;
    mesh.current.getWorldPosition(world);
    mesh.current.scale.setScalar(world.distanceTo(camera.position) * HANDLE_SCREEN_SCALE);
  });
  return (
    <mesh
      ref={mesh}
      position={position}
      renderOrder={1000}
      // Same priority as the transform gizmo: the handle wins over the object under it.
      userData={{ transformGizmo: true, editorHelper: true }}
      onPointerDown={onDragStart}
      onClick={(event) => event.stopPropagation()}
      onPointerOver={(event) => {
        event.stopPropagation();
        document.body.style.cursor = cursor;
      }}
      onPointerOut={() => {
        document.body.style.cursor = '';
      }}
    >
      <sphereGeometry args={[1, 16, 12]} />
      <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.95} />
    </mesh>
  );
}

interface ZoneRanges {
  xRange: RangeFields;
  yRange: RangeFields;
  yawRange: RangeFields;
}

/** Another object scattered in this zone, drawn as faint outlines of its own footprint. */
interface SharedObject {
  body: string;
  /** Authored origin, to measure the object's footprint. */
  origin: readonly [number, number, number];
  color: string;
  seed: number;
}

/**
 * The Generate randomization zones, drawn on the surface under each object: a translucent
 * rectangle of possible start positions, a yaw fan, and faint example placements. Drag a centre
 * handle to move a zone and a corner to resize it; the ranges in the panel follow. Extra objects
 * that share the main zone are drawn as outlines inside it in their own colour.
 */
export function GenerationZone({
  target,
  onInteractionChange,
}: {
  target: GenerationZoneTarget;
  onInteractionChange: (active: boolean) => void;
}) {
  const { sceneKey, body, origin, disabled, bodyOrigins } = target;
  const [settings, updateSettings] = useGenerationSettings(sceneKey);
  const extras = settings.extraObjects
    .map((object, index) => ({ object, index, origin: bodyOrigins[object.body] }))
    .filter(
      (
        entry,
      ): entry is {
        object: ExtraObjectSettings;
        index: number;
        origin: [number, number, number];
      } => entry.object.body !== body && entry.origin !== undefined,
    );
  const updateExtra = (name: string, changes: Partial<ZoneRanges>) =>
    updateSettings({
      extraObjects: settings.extraObjects.map((object) =>
        object.body === name ? { ...object, ...changes } : object,
      ),
    });
  return (
    <group rotation={[MUJOCO_ROOT_ROTATION_X, 0, 0]} name="generation-zone">
      <ZoneEditor
        body={body}
        origin={origin}
        ranges={settings}
        color={zoneColor(0)}
        disabled={disabled}
        shared={extras
          .filter(({ object }) => object.shareZone)
          .map(({ object, index, origin: extraOrigin }) => ({
            body: object.body,
            origin: extraOrigin,
            color: zoneColor(index + 1),
            seed: 101 + index,
          }))}
        onChange={(ranges) => updateSettings(ranges)}
        onInteractionChange={onInteractionChange}
      />
      {extras
        .filter(({ object }) => !object.shareZone)
        .map(({ object, index, origin: extraOrigin }) => (
          <ZoneEditor
            key={object.body}
            body={object.body}
            origin={extraOrigin}
            ranges={object}
            color={zoneColor(index + 1)}
            disabled={disabled}
            label={object.body}
            shared={[]}
            onChange={(ranges) => updateExtra(object.body, ranges)}
            onInteractionChange={onInteractionChange}
          />
        ))}
    </group>
  );
}

function FootprintOutlines({
  body,
  bodyOrigin,
  samples,
  origin,
  z,
  color,
  opacity,
}: {
  body: string;
  /** Authored origin of `body`, used to measure its footprint. */
  bodyOrigin: readonly [number, number, number];
  samples: readonly { x: number; y: number; yaw: number }[];
  origin: readonly [number, number, number];
  z: number;
  color: string;
  opacity: number;
}) {
  const footprint = useFootprint(body, bodyOrigin);
  const halfW = footprint.width / 2;
  const halfD = footprint.depth / 2;
  const [cx, cy] = footprint.center;
  return (
    <>
      {samples.map((sample, index) => (
        <group
          key={index}
          position={[origin[0] + sample.x, origin[1] + sample.y, z + 0.0005]}
          rotation={[0, 0, sample.yaw]}
        >
          <Line
            points={rectPoints(cx - halfW, cx + halfW, cy - halfD, cy + halfD, 0)}
            color={color}
            lineWidth={1}
            transparent
            opacity={opacity}
            userData={{ editorHelper: true }}
          />
        </group>
      ))}
    </>
  );
}

function ZoneEditor({
  body,
  origin,
  ranges,
  color: activeColor,
  disabled,
  label,
  shared,
  onChange,
  onInteractionChange,
}: {
  body: string;
  origin: readonly [number, number, number];
  ranges: ZoneRanges;
  color: string;
  disabled: boolean;
  /** Object name shown next to the size (extra objects only). */
  label?: string;
  shared: readonly SharedObject[];
  onChange: (ranges: Pick<ZoneRanges, 'xRange' | 'yRange'>) => void;
  onInteractionChange: (active: boolean) => void;
}) {
  const zone = zoneFromRanges(ranges.xRange, ranges.yRange);
  const yaw = yawFromRange(ranges.yawRange);
  const footprint = useFootprint(body, origin);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const [dragging, setDragging] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      cleanupRef.current?.();
      document.body.style.cursor = '';
    },
    [],
  );

  const samples = useMemo(
    () => (zone ? previewSamples(zone, yaw, PREVIEW_COUNT) : []),
    // Recompute only when the numbers change, not on every settings object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [zone?.minX, zone?.maxX, zone?.minY, zone?.maxY, yaw?.minRad, yaw?.maxRad],
  );

  if (!zone) return null;

  // Zone offsets are for the body origin; draw them around the visible centre instead.
  const ox = origin[0] + footprint.center[0];
  const oy = origin[1] + footprint.center[1];
  const z = footprint.bottom + 0.0015;
  const color = disabled ? LOCKED_COLOR : activeColor;
  const width = zone.maxX - zone.minX;
  const depth = zone.maxY - zone.minY;
  const centerX = ox + (zone.minX + zone.maxX) / 2;
  const centerY = oy + (zone.minY + zone.maxY) / 2;
  const fanRadius = Math.max(footprint.width, footprint.depth, 0.02) * 0.9;
  const showFan = yaw !== null && yaw.maxRad - yaw.minRad > 1e-6;
  // Shared objects split the preview count so the zone does not get crowded.
  const sharedCount = Math.max(3, Math.round(PREVIEW_COUNT / (shared.length + 1)));

  // Offset (relative to the authored position) of the surface point under the pointer.
  const surfaceOffset = (clientX: number, clientY: number): [number, number] | null => {
    const rect = gl.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    // MuJoCo z is three.js y, so the surface is the horizontal plane y = z.
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -z);
    const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return null;
    return [hit.x - ox, -hit.z - oy];
  };

  const beginDrag = (drag: Drag, event: ThreeEvent<PointerEvent>) => {
    if (disabled || event.button !== 0) return;
    event.stopPropagation();
    const start = surfaceOffset(event.clientX, event.clientY);
    if (!start) return;
    const startZone: ZoneRect = zone;
    const move = (pointerEvent: PointerEvent) => {
      const point = surfaceOffset(pointerEvent.clientX, pointerEvent.clientY);
      if (!point) return;
      const next =
        drag.kind === 'move'
          ? moveZone(startZone, point[0] - start[0], point[1] - start[1])
          : resizeZone(startZone, drag.corner, point);
      onChange(rangesFromZone(next));
    };
    const end = () => {
      cleanupRef.current?.();
    };
    cleanupRef.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      cleanupRef.current = null;
      setDragging(false);
      onInteractionChange(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    setDragging(true);
    onInteractionChange(true);
  };

  return (
    <group name={label ? `generation-zone-${label}` : 'generation-zone-main'}>
      <mesh position={[centerX, centerY, z]} renderOrder={10} userData={{ editorHelper: true }}>
        <planeGeometry args={[Math.max(width, 1e-4), Math.max(depth, 1e-4)]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={dragging ? 0.28 : 0.16}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <Line
        points={rectPoints(ox + zone.minX, ox + zone.maxX, oy + zone.minY, oy + zone.maxY, z)}
        color={color}
        lineWidth={1.5}
        userData={{ editorHelper: true }}
      />

      <FootprintOutlines
        body={body}
        bodyOrigin={origin}
        samples={shared.length > 0 ? samples.slice(0, sharedCount) : samples}
        origin={origin}
        z={z}
        color={color}
        opacity={0.35}
      />
      {shared.map((object) => (
        <FootprintOutlines
          key={object.body}
          body={object.body}
          bodyOrigin={object.origin}
          samples={previewSamples(zone, yaw, sharedCount, object.seed)}
          origin={origin}
          z={z}
          color={disabled ? LOCKED_COLOR : object.color}
          opacity={0.55}
        />
      ))}

      {showFan && (
        <mesh position={[ox, oy, z + 0.001]} renderOrder={11} userData={{ editorHelper: true }}>
          <circleGeometry args={[fanRadius, 32, yaw.minRad, yaw.maxRad - yaw.minRad]} />
          <meshBasicMaterial
            color="#f59e0b"
            transparent
            opacity={0.22}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {!disabled && (
        <>
          <Handle
            position={[centerX, centerY, z]}
            color={color}
            cursor="move"
            onDragStart={(event) => beginDrag({ kind: 'move' }, event)}
          />
          {CORNERS.map((corner) => (
            <Handle
              key={corner.join()}
              position={[
                ox + (corner[0] < 0 ? zone.minX : zone.maxX),
                oy + (corner[1] < 0 ? zone.minY : zone.maxY),
                z,
              ]}
              color="#ffffff"
              cursor="nwse-resize"
              onDragStart={(event) => beginDrag({ kind: 'corner', corner }, event)}
            />
          ))}
        </>
      )}

      <Html
        position={[ox + zone.maxX, oy + zone.maxY, z]}
        style={{ pointerEvents: 'none' }}
        zIndexRange={[20, 0]}
      >
        <div
          aria-label={label ? `${label} zone size` : 'Randomization zone size'}
          className="ml-2 -translate-y-full whitespace-nowrap border bg-background/85 px-1.5 py-0.5 text-[10px] text-foreground"
          style={{ borderColor: color }}
        >
          {label ? `${label} · ${zoneSizeLabel(zone)}` : zoneSizeLabel(zone)}
        </div>
      </Html>
    </group>
  );
}
