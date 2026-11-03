// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ribbonPath, type Leg3, type Pose } from "./map-3d-trip";
import { ROUTE_COLOR, type World } from "./map-3d-world";

const STRIDE = 2.2;
const DONE_COLOR = "#9fb2af";

const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);
const turn = (a: number, b: number, t: number) => {
  const d = ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return a + d * t;
};

function Limb({ limb, radius, length, x, y, material }: {
  limb: React.RefObject<THREE.Group | null>;
  radius: number;
  length: number;
  x: number;
  y: number;
  material: THREE.Material;
}) {
  return (
    <group ref={limb} position={[x, y, 0]}>
      <mesh position-y={-(length / 2 + radius)} material={material}>
        <capsuleGeometry args={[radius, length, 4, 10]} />
      </mesh>
    </group>
  );
}

export function Walker({ pose, moving }: { pose: Pose; moving: boolean }) {
  const root = useRef<THREE.Group>(null);
  const figure = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const anim = useRef({ heading: Number.NaN, walk: 0, rail: 0 });
  const mats = useMemo(
    () => ({
      body: new THREE.MeshStandardMaterial({ color: "#0b7c74", roughness: 0.55 }),
      legs: new THREE.MeshStandardMaterial({ color: "#134e4a", roughness: 0.7 }),
      head: new THREE.MeshStandardMaterial({ color: "#eef4f3", roughness: 0.5 }),
      shadow: new THREE.MeshBasicMaterial({ color: "#0d2f2c", transparent: true, opacity: 0.22, depthWrite: false }),
      ring: new THREE.MeshBasicMaterial({ color: ROUTE_COLOR, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }),
      arrow: new THREE.MeshBasicMaterial({ color: ROUTE_COLOR, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
    }),
    [],
  );
  const arrow = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 2.05);
    s.lineTo(0.42, 1.45);
    s.lineTo(-0.42, 1.45);
    s.closePath();
    return new THREE.ShapeGeometry(s);
  }, []);
  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m.dispose());
      arrow.dispose();
    },
    [mats, arrow],
  );

  useFrame(({ clock }, dt) => {
    const a = anim.current;
    if (pose.heading !== null) a.heading = Number.isNaN(a.heading) ? pose.heading : turn(a.heading, pose.heading, ease(dt, 9));
    a.walk += ((moving && pose.mode === "walk" ? 1 : 0) - a.walk) * ease(dt, 10);
    a.rail += ((pose.mode === "ride" ? 1 : 0) - a.rail) * ease(dt, 6);
    const swing = Math.sin((pose.walked / STRIDE) * Math.PI * 2) * 0.55 * a.walk;
    if (root.current) {
      root.current.position.copy(pose.pos);
      root.current.rotation.y = Number.isNaN(a.heading) ? 0 : a.heading;
    }
    if (figure.current) figure.current.position.y = Math.abs(Math.cos((pose.walked / STRIDE) * Math.PI * 2)) * 0.05 * a.walk;
    if (legL.current) legL.current.rotation.x = swing;
    if (legR.current) legR.current.rotation.x = -swing;
    if (armL.current) armL.current.rotation.x = -swing * 0.8;
    if (armR.current) armR.current.rotation.x = swing * 0.8 * (1 - a.rail) - 0.55 * a.rail;
    if (ring.current) {
      const t = (clock.elapsedTime * 0.9) % 1;
      ring.current.scale.setScalar(1 + t * 0.9);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - t);
    }
  });

  return (
    <group ref={root}>
      <group ref={figure} scale={1.2}>
        <mesh position-y={1.18} material={mats.body}>
          <capsuleGeometry args={[0.22, 0.42, 6, 14]} />
        </mesh>
        <mesh position-y={1.83} material={mats.head}>
          <sphereGeometry args={[0.19, 22, 16]} />
        </mesh>
        <mesh position-y={1.85} material={mats.body}>
          <sphereGeometry args={[0.2, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2.4]} />
        </mesh>
        <Limb limb={legL} radius={0.095} length={0.62} x={-0.11} y={0.82} material={mats.legs} />
        <Limb limb={legR} radius={0.095} length={0.62} x={0.11} y={0.82} material={mats.legs} />
        <Limb limb={armL} radius={0.07} length={0.46} x={-0.3} y={1.5} material={mats.body} />
        <Limb limb={armR} radius={0.07} length={0.46} x={0.3} y={1.5} material={mats.body} />
      </group>
      <mesh rotation-x={-Math.PI / 2} position-y={0.03} material={mats.shadow}>
        <circleGeometry args={[0.75, 28]} />
      </mesh>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.04} material={mats.ring}>
        <ringGeometry args={[1, 1.25, 40]} />
      </mesh>
      <mesh rotation-x={Math.PI / 2} position-y={0.05} geometry={arrow} material={mats.arrow} />
    </group>
  );
}

const VERTEX = `
attribute float dist;
attribute float side;
attribute float lvl;
varying float vDist;
varying float vSide;
varying float vLvl;
void main() {
  vDist = dist;
  vSide = side;
  vLvl = lvl;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = `
uniform vec3 uColor;
uniform vec3 uDone;
uniform float uProgress;
uniform float uTime;
uniform float uOpacity;
uniform float uStripes;
uniform float uFocus;
varying float vDist;
varying float vSide;
varying float vLvl;
void main() {
  float s = abs(vSide);
  float edge = 1.0 - smoothstep(0.78, 1.0, s);
  float m = fract((vDist + s * 0.6 - uTime * 2.4) / 2.4);
  float stripe = uStripes * smoothstep(0.0, 0.05, m) * (1.0 - smoothstep(0.26, 0.31, m));
  float done = step(vDist, uProgress);
  vec3 c = mix(uColor, vec3(1.0), stripe * 0.6 * (1.0 - done));
  c = mix(c, uDone, done);
  float away = smoothstep(0.3, 0.85, abs(vLvl - uFocus));
  gl_FragColor = vec4(c, uOpacity * edge * mix(1.0, 0.8, done) * mix(1.0, 0.3, away));
  #include <colorspace_fragment>
}`;

function ribbonGeometry(points: THREE.Vector3[], dists: number[], width: number, world: World) {
  const pos: number[] = [];
  const dist: number[] = [];
  const side: number[] = [];
  const lvl: number[] = [];
  const idx: number[] = [];
  const hw = width / 2;
  const push = (v: THREE.Vector3, d: number, s: number) => {
    pos.push(v.x, v.y, v.z);
    dist.push(d);
    side.push(s);
    lvl.push(world.levelAt(v.y));
    return pos.length / 3 - 1;
  };
  let dir = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const flat = b.clone().sub(a).setY(0);
    if (flat.length() > 1e-3) dir = flat.normalize();
    const perp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(hw);
    const i0 = push(a.clone().add(perp), dists[i], 1);
    const i1 = push(a.clone().sub(perp), dists[i], -1);
    const i2 = push(b.clone().add(perp), dists[i + 1], 1);
    const i3 = push(b.clone().sub(perp), dists[i + 1], -1);
    idx.push(i0, i1, i2, i1, i3, i2);
    if (i < points.length - 2) {
      const c = push(b, dists[i + 1], 0);
      let prev = -1;
      for (let k = 0; k <= 14; k++) {
        const ang = (k / 14) * Math.PI * 2;
        const v = push(b.clone().add(new THREE.Vector3(Math.cos(ang) * hw, 0, Math.sin(ang) * hw)), dists[i + 1], 1);
        if (prev >= 0) idx.push(c, prev, v);
        prev = v;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("dist", new THREE.Float32BufferAttribute(dist, 1));
  g.setAttribute("side", new THREE.Float32BufferAttribute(side, 1));
  g.setAttribute("lvl", new THREE.Float32BufferAttribute(lvl, 1));
  g.setIndex(idx);
  return g;
}

export function RouteRibbon({
  legs,
  world,
  distance,
  started,
  focus,
}: {
  legs: Leg3[];
  world: World;
  distance: number;
  started: boolean;
  focus: number;
}) {
  const parts = useMemo(() => {
    const { points, dist } = ribbonPath(legs);
    const make = (width: number, opacity: number, stripes: number, order: number) => ({
      order,
      geometry: ribbonGeometry(points, dist, width, world),
      material: new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(ROUTE_COLOR) },
          uDone: { value: new THREE.Color(DONE_COLOR) },
          uProgress: { value: -1 },
          uTime: { value: 0 },
          uOpacity: { value: opacity },
          uStripes: { value: stripes },
          uFocus: { value: Number.NaN },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    });
    return [make(2.8, 0.18, 0, 4), make(1.1, 0.95, 1, 5)];
  }, [legs, world]);
  useEffect(
    () => () =>
      parts.forEach((p) => {
        p.geometry.dispose();
        p.material.dispose();
      }),
    [parts],
  );

  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ clock }, dt) => {
    for (const mesh of meshes.current) {
      if (!mesh) continue;
      const u = (mesh.material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = clock.elapsedTime;
      u.uProgress.value = started ? distance : -1;
      u.uFocus.value = Number.isNaN(u.uFocus.value) ? focus : u.uFocus.value + (focus - u.uFocus.value) * ease(dt, 5);
    }
  });

  return (
    <>
      {parts.map((p, i) => (
        <mesh
          key={p.order}
          ref={(mesh) => {
            meshes.current[i] = mesh;
          }}
          geometry={p.geometry}
          material={p.material}
          renderOrder={p.order}
        />
      ))}
    </>
  );
}
