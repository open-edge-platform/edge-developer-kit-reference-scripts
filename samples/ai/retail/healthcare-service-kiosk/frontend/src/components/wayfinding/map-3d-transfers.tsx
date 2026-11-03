// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { clamp01, flightY, liftRide, type FlightModel, type Leg3, type ShaftModel } from "./map-3d-trip";
import { ROUTE_COLOR } from "./map-3d-world";

const STEP = 0.42;
const RAIL = 1.02;
const SIDE = 0.62;

type Ride = Extract<Leg3, { kind: "ride" }>;
type LiftLeg = Extract<Leg3, { kind: "lift" }>;
type FlightMats = Record<"truss" | "glass" | "rail" | "step" | "lip", THREE.Material>;

function flightMats(rail: string, truss: string, opacity: number): FlightMats {
  const solid = opacity > 0.9;
  const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, transparent: !solid, opacity, depthWrite: solid, ...extra });
  return {
    truss: std(truss, { roughness: 0.45, metalness: 0.35 }),
    glass: new THREE.MeshStandardMaterial({
      color: "#cfe8e4",
      roughness: 0.1,
      transparent: true,
      opacity: 0.3 * opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    rail: std(rail, { roughness: 0.5 }),
    step: std("#3d4855", { roughness: 0.55, metalness: 0.3 }),
    lip: std("#f5c518", { roughness: 0.6 }),
  };
}

/** Escalators touching the floor on show, plus every one the route rides; only those move. */
export function Escalators({
  models,
  legs,
  focus,
  distance,
}: {
  models: FlightModel[];
  legs: Leg3[];
  focus: number;
  distance: number;
}) {
  const mats = useMemo(
    () => ({
      route: flightMats(ROUTE_COLOR, "#b5ddd7", 1),
      routeFar: flightMats(ROUTE_COLOR, "#b5ddd7", 0.4),
      near: flightMats("#2f3b4a", "#d4dce1", 0.3),
    }),
    [],
  );
  const rides = useMemo(() => {
    const out = new Map<string, Ride[]>();
    for (const leg of legs) if (leg.kind === "ride") out.set(leg.model.flight.id, [...(out.get(leg.model.flight.id) ?? []), leg]);
    return out;
  }, [legs]);
  useEffect(
    () => () => Object.values(mats).forEach((set) => Object.values(set).forEach((m) => m.dispose())),
    [mats],
  );

  return (
    <>
      {models.map((m) => {
        const onRoute = rides.get(m.flight.id);
        const touches = m.lowerLevel === focus || m.upperLevel === focus;
        if (!onRoute && !touches) return null;
        const set = onRoute ? (touches ? mats.route : mats.routeFar) : mats.near;
        return <Flight key={m.flight.id} model={m} mats={set} rides={onRoute} distance={distance} />;
      })}
    </>
  );
}

function flightGeometry(m: FlightModel) {
  const top = new THREE.Shape();
  top.moveTo(0, -0.03);
  top.lineTo(m.land, -0.03);
  top.lineTo(m.land + m.run, m.rise - 0.03);
  top.lineTo(m.h, m.rise - 0.03);
  top.lineTo(m.h, m.rise - 0.95);
  top.lineTo(m.land + m.run, m.rise - 0.95);
  top.lineTo(m.land, -0.95);
  top.lineTo(0, -0.95);
  top.closePath();
  const truss = new THREE.ExtrudeGeometry(top, { depth: 1.3, bevelEnabled: false });
  truss.translate(0, 0, -0.65);

  const band = new THREE.Shape();
  band.moveTo(0, 0.08);
  band.lineTo(m.land, 0.08);
  band.lineTo(m.land + m.run, m.rise + 0.08);
  band.lineTo(m.h, m.rise + 0.08);
  band.lineTo(m.h, m.rise + 1);
  band.lineTo(m.land + m.run, m.rise + 1);
  band.lineTo(m.land, 1);
  band.lineTo(0, 1);
  band.closePath();
  const glass = new THREE.ShapeGeometry(band);

  const path = new THREE.CurvePath<THREE.Vector3>();
  const corners = [
    [0, RAIL],
    [m.land, RAIL],
    [m.land + m.run, m.rise + RAIL],
    [m.h, m.rise + RAIL],
  ].map(([x, y]) => new THREE.Vector3(x, y, 0));
  for (let i = 0; i < 3; i++) path.add(new THREE.LineCurve3(corners[i], corners[i + 1]));
  const rail = new THREE.TubeGeometry(path, 64, 0.065, 6, false);

  const n = Math.max(2, Math.ceil(m.h / STEP));
  const pitch = m.h / n;
  const riser = m.run > 0 ? (pitch * m.rise) / m.run : 0;
  const stepHeight = Math.max(0.27, riser + 0.05);
  const step = new THREE.BoxGeometry(pitch - 0.03, stepHeight, 1.02);
  step.translate(0, -stepHeight / 2, 0);
  const lip = new THREE.BoxGeometry(0.05, 0.02, 1.02);
  return { truss, glass, rail, step, lip, n, pitch };
}

function Flight({ model, mats, rides, distance }: { model: FlightModel; mats: FlightMats; rides?: Ride[]; distance: number }) {
  const geo = useMemo(() => flightGeometry(model), [model]);
  const steps = useRef<THREE.InstancedMesh>(null);
  const lips = useRef<THREE.InstancedMesh>(null);
  const placed = useRef(Number.NaN);
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  useEffect(
    () => () => {
      for (const g of [geo.truss, geo.glass, geo.rail, geo.step, geo.lip]) g.dispose();
    },
    [geo],
  );

  useFrame(() => {
    let offset = 0;
    if (rides) {
      const ride = rides.find((r) => distance <= r.d1 + (r.d1 - r.d0) * 0.2) ?? rides[rides.length - 1];
      const p = ride.d1 > ride.d0 ? (distance - ride.d0) / (ride.d1 - ride.d0) : 1;
      offset = (ride.up ? 1 : -1) * Math.min(1.15, Math.max(-0.15, p)) * model.h;
    }
    if (offset === placed.current || !steps.current) return;
    placed.current = offset;
    for (let i = 0; i < geo.n; i++) {
      const s = (((i * geo.pitch + offset) % model.h) + model.h) % model.h;
      const y = flightY(model, s);
      m4.makeTranslation(s, y, 0);
      steps.current.setMatrixAt(i, m4);
      if (lips.current) {
        m4.makeTranslation(s + geo.pitch / 2 - 0.04, y + 0.005, 0);
        lips.current.setMatrixAt(i, m4);
      }
    }
    steps.current.instanceMatrix.needsUpdate = true;
    if (lips.current) lips.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group position={model.origin} rotation-y={model.yaw}>
      <mesh geometry={geo.truss} material={mats.truss} />
      <mesh geometry={geo.glass} material={mats.glass} position-z={-SIDE} />
      <mesh geometry={geo.glass} material={mats.glass} position-z={SIDE} />
      <mesh geometry={geo.rail} material={mats.rail} position-z={-SIDE} />
      <mesh geometry={geo.rail} material={mats.rail} position-z={SIDE} />
      <instancedMesh ref={steps} args={[geo.step, mats.step, geo.n]} frustumCulled={false} />
      {rides && <instancedMesh ref={lips} args={[geo.lip, mats.lip, geo.n]} frustumCulled={false} />}
    </group>
  );
}

export function Lifts({
  models,
  legs,
  distance,
  startLevel,
}: {
  models: ShaftModel[];
  legs: Leg3[];
  distance: number;
  startLevel: number;
}) {
  return (
    <>
      {models.map((m) => (
        <Lift
          key={m.shaft.id}
          model={m}
          rides={legs.filter((l): l is LiftLeg => l.kind === "lift" && l.model === m)}
          distance={distance}
          startLevel={startLevel}
        />
      ))}
    </>
  );
}

function carAt(rides: LiftLeg[], distance: number, idle: number): { y: number; doors: number } {
  if (rides.length === 0) return { y: idle, doors: 0 };
  const ride = rides.find((r) => distance <= r.d1 + 6) ?? rides[rides.length - 1];
  if (distance < ride.d0) return { y: ride.y0, doors: clamp01((distance - (ride.d0 - 8)) / 1.5) };
  if (distance <= ride.d1) return liftRide(ride, ride.d1 > ride.d0 ? (distance - ride.d0) / (ride.d1 - ride.d0) : 1);
  return { y: ride.y1, doors: clamp01(1 - (distance - ride.d1 - 4) / 2) };
}

function Lift({ model, rides, distance, startLevel }: { model: ShaftModel; rides: LiftLeg[]; distance: number; startLevel: number }) {
  const onRoute = rides.length > 0;
  const height = model.top - model.bottom;
  const idle = (model.stops.find((s) => s.level === startLevel) ?? model.stops[0]).y;
  const car = useRef<THREE.Group>(null);
  const doorL = useRef<THREE.Mesh>(null);
  const doorR = useRef<THREE.Mesh>(null);

  const mats = useMemo(
    () => ({
      shaft: new THREE.MeshStandardMaterial({ color: "#d9eeea", roughness: 0.1, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }),
      post: new THREE.MeshStandardMaterial({
        color: onRoute ? ROUTE_COLOR : "#5b6b78",
        roughness: 0.5,
        metalness: 0.4,
        transparent: !onRoute,
        opacity: onRoute ? 1 : 0.35,
        depthWrite: onRoute,
      }),
      ring: new THREE.LineBasicMaterial({ color: "#6e8a86", transparent: true, opacity: 0.35 }),
      steel: new THREE.MeshStandardMaterial({ color: "#c3ccd4", roughness: 0.35, metalness: 0.55 }),
      glass: new THREE.MeshStandardMaterial({ color: "#bfe3dd", roughness: 0.05, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }),
      door: new THREE.MeshStandardMaterial({ color: "#9fb0bd", roughness: 0.3, metalness: 0.6 }),
      lamp: new THREE.MeshBasicMaterial({ color: "#fffbe8" }),
    }),
    [onRoute],
  );
  const rings = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const c = [
      [-1.56, -1.56],
      [1.56, -1.56],
      [1.56, 1.56],
      [-1.56, 1.56],
    ];
    for (const { y } of model.stops) {
      for (let i = 0; i < 4; i++) {
        const [ax, az] = c[i];
        const [bx, bz] = c[(i + 1) % 4];
        pts.push(new THREE.Vector3(ax, y + 2.9, az), new THREE.Vector3(bx, y + 2.9, bz));
      }
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [model]);
  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m.dispose());
      rings.dispose();
    },
    [mats, rings],
  );

  useFrame(() => {
    const { y, doors } = carAt(rides, distance, idle);
    if (car.current) car.current.position.y = y;
    const w = 1 - 0.84 * clamp01(doors);
    if (doorL.current && doorR.current) {
      doorL.current.scale.x = w;
      doorR.current.scale.x = w;
      doorL.current.position.x = -1.35 + 0.675 * w;
      doorR.current.position.x = 1.35 - 0.675 * w;
    }
  });

  return (
    <group position={[model.x, 0, model.z]} rotation-y={model.yaw}>
      <mesh position-y={model.bottom + height / 2} material={mats.shaft}>
        <boxGeometry args={[3.1, height, 3.1]} />
      </mesh>
      {[
        [-1.55, -1.55],
        [1.55, -1.55],
        [-1.55, 1.55],
        [1.55, 1.55],
      ].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, model.bottom + height / 2, z]} material={mats.post}>
          <boxGeometry args={[0.16, height, 0.16]} />
        </mesh>
      ))}
      <lineSegments geometry={rings} material={mats.ring} />
      <group ref={car} position-y={idle}>
        <mesh position-y={0.08} material={mats.steel}>
          <boxGeometry args={[2.7, 0.16, 2.7]} />
        </mesh>
        <mesh position-y={2.62} material={mats.steel}>
          <boxGeometry args={[2.7, 0.14, 2.7]} />
        </mesh>
        <mesh position-y={2.54} material={mats.lamp}>
          <boxGeometry args={[1.4, 0.02, 1.4]} />
        </mesh>
        <mesh position={[0, 1.35, -1.33]} material={mats.glass}>
          <boxGeometry args={[2.7, 2.46, 0.05]} />
        </mesh>
        {[-1.33, 1.33].map((x) => (
          <mesh key={x} position={[x, 1.35, 0]} material={mats.glass}>
            <boxGeometry args={[0.05, 2.46, 2.7]} />
          </mesh>
        ))}
        <mesh ref={doorL} position={[-0.675, 1.38, 1.36]} material={mats.door}>
          <boxGeometry args={[1.35, 2.44, 0.06]} />
        </mesh>
        <mesh ref={doorR} position={[0.675, 1.38, 1.36]} material={mats.door}>
          <boxGeometry args={[1.35, 2.44, 0.06]} />
        </mesh>
      </group>
    </group>
  );
}
