// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Route } from "@/lib/wayfinding/routing";
import type { Level, LoadedMap } from "@/lib/wayfinding/types";
import { framingArea, type Inset } from "./map-2d";
import { ROOM_HEIGHT, SLAB, type World } from "./map-3d-world";

/** What to frame: the whole route, or the floor whose chip was tapped. Each request bumps `n`. */
export type Aim = { n: number; levelId?: string };

type Glide = { target: THREE.Vector3; position: THREE.Vector3 };
type Controls = React.RefObject<OrbitControlsImpl | null>;

const VIEW_DIR = new THREE.Vector3(0.7, 0.85, 1).normalize();
const MIN_SPAN = 40;
const MARGIN = 0.06;
const MAX_DISTANCE = 600;

const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);

export function Cameras({
  map,
  route,
  world,
  inset,
  aim,
  follow,
  onStart,
}: {
  map: LoadedMap;
  route: Route | null;
  world: World;
  inset: Inset;
  aim: Aim;
  follow: THREE.Vector3 | null;
  onStart: () => void;
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const glideRef = useRef<Glide | null>(null);
  const movedRef = useRef(false);
  return (
    <>
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.1}
        maxPolarAngle={Math.PI / 2.05}
        minDistance={5}
        maxDistance={MAX_DISTANCE}
        onStart={() => {
          glideRef.current = null;
          movedRef.current = true;
          onStart();
        }}
      />
      <ViewOffset inset={inset} />
      <FrameView controls={controls} glideRef={glideRef} movedRef={movedRef} map={map} route={route} world={world} inset={inset} aim={aim} following={follow !== null} />
      <Glider controls={controls} glideRef={glideRef} paused={follow !== null} />
      <FollowCamera controls={controls} target={follow} />
    </>
  );
}

/** Shifts the projection so the point the camera looks at sits mid-way across the area the panels leave free. */
function ViewOffset({ inset }: { inset: Inset }) {
  const camera = useThree((s) => s.camera);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const { top, right, bottom, left } = framingArea(inset);
  useLayoutEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) applyOffset(camera, width, height, { top, right, bottom, left });
  }, [camera, width, height, top, right, bottom, left]);
  return null;
}

function applyOffset(camera: THREE.PerspectiveCamera, width: number, height: number, area: Inset) {
  const x = (area.right - area.left) / 2;
  const y = (area.bottom - area.top) / 2;
  if (x || y) camera.setViewOffset(width, height, x, y, width, height);
  else camera.clearViewOffset();
}

/**
 * Frames a new route at once; a tap on a floor chip or "Fit the route" glides there.
 * When the panels or the canvas change size it refits, unless the visitor has turned or zoomed the view since.
 */
function FrameView({
  controls,
  glideRef,
  movedRef,
  map,
  route,
  world,
  inset,
  aim,
  following,
}: {
  controls: Controls;
  glideRef: React.RefObject<Glide | null>;
  movedRef: React.RefObject<boolean>;
  map: LoadedMap;
  route: Route | null;
  world: World;
  inset: Inset;
  aim: Aim;
  following: boolean;
}) {
  const camera = useThree((s) => s.camera);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const { top, right, bottom, left } = inset;
  const last = useRef<{ route: Route; aim: Aim } | null>(null);
  const followingRef = useRef(following);
  useLayoutEffect(() => {
    followingRef.current = following;
  }, [following]);

  useLayoutEffect(() => {
    const c = controls.current;
    if (!c || !route || route.points.length === 0 || !(camera instanceof THREE.PerspectiveCamera)) return;
    const prev = last.current;
    last.current = { route, aim };
    const fresh = prev?.route !== route;
    const asked = !fresh && prev?.aim !== aim;
    if (!fresh && (followingRef.current || (!asked && movedRef.current))) return;

    const level = aim.levelId && !fresh ? map.levelsById.get(aim.levelId) : undefined;
    const points = level ? levelPoints(level, world) : cornersOf(routeBox(route, world));
    const dir = level ? facing(camera.position.clone().sub(c.target)) : VIEW_DIR;
    const shot = fit(camera, points, dir, width, height, { top, right, bottom, left });
    movedRef.current = false;
    if (fresh) {
      glideRef.current = null;
      camera.position.copy(shot.position);
      c.target.copy(shot.target);
      c.update();
    } else {
      glideRef.current = shot;
    }
  }, [controls, glideRef, movedRef, camera, map, route, world, aim, width, height, top, right, bottom, left]);
  return null;
}

function facing(offset: THREE.Vector3): THREE.Vector3 {
  const flat = Math.hypot(offset.x, offset.z);
  if (flat < 1e-3) return VIEW_DIR;
  const across = Math.hypot(VIEW_DIR.x, VIEW_DIR.z);
  return new THREE.Vector3((offset.x / flat) * across, VIEW_DIR.y, (offset.z / flat) * across);
}

function fit(camera: THREE.PerspectiveCamera, points: THREE.Vector3[], dir: THREE.Vector3, width: number, height: number, inset: Inset): Glide {
  const area = framingArea(inset);
  const probe = camera.clone();
  probe.aspect = width / height;
  applyOffset(probe, width, height, area);

  const w = Math.max(40, width - area.left - area.right);
  const h = Math.max(40, height - area.top - area.bottom);
  const x0 = ((area.left + w * MARGIN) / width) * 2 - 1;
  const x1 = ((area.left + w * (1 - MARGIN)) / width) * 2 - 1;
  const y0 = 1 - ((area.top + h * (1 - MARGIN)) / height) * 2;
  const y1 = 1 - ((area.top + h * MARGIN) / height) * 2;

  const target = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  const v = new THREE.Vector3();
  const fits = (distance: number) => {
    probe.position.copy(target).addScaledVector(dir, distance);
    probe.lookAt(target);
    probe.updateMatrixWorld(true);
    return points.every((p) => {
      v.copy(p).project(probe);
      return v.z <= 1 && v.x >= x0 && v.x <= x1 && v.y >= y0 && v.y <= y1;
    });
  };
  let near = 5;
  let far = MAX_DISTANCE;
  if (fits(far)) {
    for (let i = 0; i < 30; i++) {
      const mid = (near + far) / 2;
      if (fits(mid)) far = mid;
      else near = mid;
    }
  }
  return { target, position: target.clone().addScaledVector(dir, far) };
}

function routeBox(route: Route, world: World): THREE.Box3 {
  const box = new THREE.Box3().setFromPoints(route.points.map((p) => new THREE.Vector3(...world.toWorld(p.x, p.y, p.z, SLAB))));
  box.max.y += ROOM_HEIGHT + 3;
  return atLeast(box, MIN_SPAN);
}

/** The floor's own outline, at floor and room height: tighter than its bounding box on a slanted floor plan. */
function levelPoints(level: Level, world: World): THREE.Vector3[] {
  return level.outline.flatMap(([x, y]) => [
    new THREE.Vector3(...world.toWorld(x, y, level.elevation, 0)),
    new THREE.Vector3(...world.toWorld(x, y, level.elevation, SLAB + ROOM_HEIGHT + 3)),
  ]);
}

function cornersOf(box: THREE.Box3): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push(new THREE.Vector3(x, y, z));
  return out;
}

function atLeast(box: THREE.Box3, span: number): THREE.Box3 {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const half = new THREE.Vector3(Math.max(size.x, span) / 2, size.y / 2, Math.max(size.z, span) / 2);
  return new THREE.Box3(center.clone().sub(half), center.clone().add(half));
}

function Glider({ controls, glideRef, paused }: { controls: Controls; glideRef: React.RefObject<Glide | null>; paused: boolean }) {
  const camera = useThree((s) => s.camera);
  useFrame((_, dt) => {
    const g = glideRef.current;
    const c = controls.current;
    if (!g || !c) return;
    if (paused) {
      glideRef.current = null;
      return;
    }
    const k = ease(dt, 5);
    c.target.lerp(g.target, k);
    camera.position.lerp(g.position, k);
    if (camera.position.distanceToSquared(g.position) < 0.01 && c.target.distanceToSquared(g.target) < 0.01) glideRef.current = null;
    c.update();
  });
  return null;
}

function FollowCamera({ controls, target }: { controls: Controls; target: THREE.Vector3 | null }) {
  const { camera } = useThree();
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const before = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const c = controls.current;
    if (!c || !target) return;
    tmp.set(target.x, target.y + 1.2, target.z);
    before.copy(c.target);
    c.target.lerp(tmp, 0.12);
    camera.position.add(c.target.clone().sub(before));
    const dist = camera.position.distanceTo(c.target);
    if (dist > 70) {
      const dir = camera.position.clone().sub(c.target).normalize();
      camera.position.copy(c.target).add(dir.multiplyScalar(THREE.MathUtils.lerp(dist, 55, 0.04)));
    }
    c.update();
  });
  return null;
}
