// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import * as THREE from "three";
import type { Flight, Shaft, TripPiece } from "@/lib/wayfinding/transfers";
import type { LoadedMap } from "@/lib/wayfinding/types";
import { SLAB, type World } from "./map-3d-world";

export type FlightModel = {
  flight: Flight;
  lowerLevel: number;
  upperLevel: number;
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  yaw: number;
  h: number;
  rise: number;
  land: number;
  run: number;
};

export type ShaftModel = {
  shaft: Shaft;
  x: number;
  z: number;
  yaw: number;
  stops: { level: number; y: number }[];
  bottom: number;
  top: number;
};

export type Leg3 =
  | { kind: "walk"; d0: number; d1: number; level: number; w0: number; a: THREE.Vector3; b: THREE.Vector3 }
  | { kind: "ride"; d0: number; d1: number; level: number; w0: number; model: FlightModel; up: boolean }
  | { kind: "lift"; d0: number; d1: number; level: number; w0: number; model: ShaftModel; y0: number; y1: number };

export type Pose = {
  pos: THREE.Vector3;
  heading: number | null;
  mode: Leg3["kind"];
  level: number;
  walked: number;
};

const DOOR = 0.15;
const SLOPE = (35 * Math.PI) / 180;
const LANDING = 1.2;
const REACH = 6;
const PAIR_SPACING = 1.6;
const BANK = /^(.*)-[UD]-[IO]$/;

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

const levelIndex = (map: LoadedMap, levelId: string) => map.levelsById.get(levelId)?.index ?? 0;

/**
 * The escalator as built: its top lands on the upper floor's landing, and it climbs at a real escalator's
 * slope back towards the lower one. The map's landing points are often further apart than that (the rest is
 * floor to walk), or closer (the foot then reaches back past the lower landing, within reason).
 */
export function flightModel(map: LoadedMap, world: World, flight: Flight): FlightModel {
  const lowerFirst = levelIndex(map, flight.from.level) < levelIndex(map, flight.to.level);
  const lo = lowerFirst ? flight.from : flight.to;
  const hi = lowerFirst ? flight.to : flight.from;
  const start = new THREE.Vector3(...world.toWorld(lo.x, lo.y, lo.elevation, SLAB));
  const end = new THREE.Vector3(...world.toWorld(hi.x, hi.y, hi.elevation, SLAB));
  const dir = end.clone().sub(start).setY(0);
  const gap = dir.length();
  if (gap > 0.01) dir.divideScalar(gap);
  else dir.set(1, 0, 0);
  const rise = end.y - start.y;
  const built = rise / Math.tan(SLOPE) + 2 * LANDING;
  const h = Math.min(built, gap + REACH);
  const origin = end.clone().addScaledVector(dir, -h).setY(start.y);
  return {
    flight,
    lowerLevel: levelIndex(map, lo.level),
    upperLevel: levelIndex(map, hi.level),
    origin,
    dir,
    yaw: Math.atan2(-dir.z, dir.x),
    h,
    rise,
    land: LANDING,
    run: h - 2 * LANDING,
  };
}

/**
 * The up and down escalators of one bank between the same two floors are one installation: the map's
 * landings put them at slightly different angles, crossing or on top of each other. Give them a shared axis
 * and set them side by side, each keeping its top landing as near the map's as the spacing allows.
 */
export function pairFlights(models: FlightModel[]): void {
  const pairs = new Map<string, FlightModel[]>();
  for (const m of models) {
    const bank = BANK.exec(m.flight.from.name ?? "")?.[1];
    if (!bank) continue;
    const key = `${bank}|${m.lowerLevel}|${m.upperLevel}`;
    pairs.set(key, [...(pairs.get(key) ?? []), m]);
  }
  for (const pair of pairs.values()) {
    if (pair.length !== 2) continue;
    const [a, b] = pair;
    const same = a.dir.dot(b.dir) >= 0 ? 1 : -1;
    const axis = a.dir.clone().addScaledVector(b.dir, same);
    if (axis.lengthSq() < 1e-6) continue;
    axis.normalize();
    const side = new THREE.Vector3(-axis.z, 0, axis.x);
    const heads = pair.map((m) => flightEnds(m).head);
    pair.forEach((m, i) => {
      m.dir.copy(axis).multiplyScalar(i === 0 ? 1 : same);
      m.yaw = Math.atan2(-m.dir.z, m.dir.x);
    });
    const centres = pair.map((m, i) => heads[i].clone().addScaledVector(m.dir, -m.h / 2));
    const apart = centres[1].sub(centres[0]).dot(side);
    const push = Math.max(0, (PAIR_SPACING - Math.abs(apart)) / 2) * (apart < 0 ? -1 : 1);
    pair.forEach((m, i) => {
      const y = m.origin.y;
      const head = heads[i].addScaledVector(side, i === 0 ? -push : push);
      m.origin.copy(head).addScaledVector(m.dir, -m.h).setY(y);
    });
  }
}

export const flightEnds = (m: FlightModel) => ({
  foot: m.origin.clone(),
  head: m.origin.clone().addScaledVector(m.dir, m.h).setY(m.origin.y + m.rise),
});

/** Height above the lower landing at `s` metres along the flight. */
export const flightY = (m: FlightModel, s: number) =>
  s <= m.land ? 0 : s >= m.land + m.run ? m.rise : ((s - m.land) / m.run) * m.rise;

const flightPoint = (m: FlightModel, s: number, out: THREE.Vector3) =>
  out.copy(m.dir).multiplyScalar(s).add(m.origin).setY(m.origin.y + flightY(m, s));

export function shaftModel(map: LoadedMap, world: World, shaft: Shaft): ShaftModel {
  const [x, , z] = world.toWorld(shaft.x, shaft.y, 0);
  const stops = shaft.nodes.map((n) => ({ level: levelIndex(map, n.level), y: world.toWorld(0, 0, n.elevation, SLAB)[1] }));
  return {
    shaft,
    x,
    z,
    yaw: Math.atan2(shaft.facing[0], -shaft.facing[1]),
    stops,
    bottom: stops[0].y - SLAB - 0.4,
    top: stops[stops.length - 1].y + 3.4,
  };
}

export function tripLegs(
  map: LoadedMap,
  world: World,
  trip: TripPiece[],
  flights: Map<string, FlightModel>,
  shafts: Map<string, ShaftModel>,
): Leg3[] {
  const legs: Leg3[] = [];
  let walked = 0;
  const at = (p: { x: number; y: number; z: number }) => new THREE.Vector3(...world.toWorld(p.x, p.y, p.z, SLAB));
  for (const p of trip) {
    const base = { d0: p.d0, d1: p.d1, w0: walked };
    const ride = p.kind === "ride" ? flights.get(p.flight.id) : undefined;
    const lift = p.kind === "lift" ? shafts.get(p.shaft.id) : undefined;
    if (p.kind === "ride" && ride) {
      legs.push({ ...base, kind: "ride", model: ride, up: levelIndex(map, p.board.level) < levelIndex(map, p.alight.level), level: ride.lowerLevel });
    } else if (p.kind === "lift" && lift) {
      legs.push({
        ...base,
        kind: "lift",
        model: lift,
        y0: at(p.from).y,
        y1: at(p.to).y,
        level: Math.min(levelIndex(map, p.from.levelId), levelIndex(map, p.to.levelId)),
      });
    } else if (p.kind !== "ride") {
      const a = at(p.from);
      const b = at(p.to);
      legs.push({ ...base, kind: "walk", a, b, level: Math.min(levelIndex(map, p.from.levelId), levelIndex(map, p.to.levelId)) });
      walked += a.distanceTo(b);
    }
  }
  legs.forEach((leg, i) => {
    if (leg.kind !== "ride") return;
    const { foot, head } = flightEnds(leg.model);
    const before = legs[i - 1];
    const after = legs[i + 1];
    if (before?.kind === "walk") before.b = leg.up ? foot : head;
    if (after?.kind === "walk") after.a = (leg.up ? head : foot).clone();
  });
  walked = 0;
  for (const leg of legs) {
    leg.w0 = walked;
    if (leg.kind === "walk") walked += leg.a.distanceTo(leg.b);
  }
  return legs;
}

/** The lift car's height and door opening (0 shut, 1 open) at `f` of the ride. */
export function liftRide(leg: Extract<Leg3, { kind: "lift" }>, f: number) {
  const y =
    f < DOOR ? leg.y0 : f > 1 - DOOR ? leg.y1 : leg.y0 + (leg.y1 - leg.y0) * smooth((f - DOOR) / (1 - 2 * DOOR));
  const doors = f < DOOR ? 1 - f / DOOR : f > 1 - DOOR ? (f - (1 - DOOR)) / DOOR : 0;
  return { y, doors };
}

export function poseAt(legs: Leg3[], distance: number): Pose | null {
  if (legs.length === 0) return null;
  const leg = legs.find((l) => distance <= l.d1) ?? legs[legs.length - 1];
  const f = leg.d1 > leg.d0 ? clamp01((distance - leg.d0) / (leg.d1 - leg.d0)) : 1;
  const pos = new THREE.Vector3();
  if (leg.kind === "walk") {
    pos.lerpVectors(leg.a, leg.b, f);
    const dx = leg.b.x - leg.a.x;
    const dz = leg.b.z - leg.a.z;
    const heading = Math.hypot(dx, dz) > 0.05 ? Math.atan2(dx, dz) : null;
    return { pos, heading, mode: "walk", level: leg.level, walked: leg.w0 + f * leg.a.distanceTo(leg.b) };
  }
  if (leg.kind === "ride") {
    const m = leg.model;
    flightPoint(m, leg.up ? f * m.h : (1 - f) * m.h, pos);
    const heading = leg.up ? Math.atan2(m.dir.x, m.dir.z) : Math.atan2(-m.dir.x, -m.dir.z);
    return { pos, heading, mode: "ride", level: leg.level, walked: leg.w0 };
  }
  pos.set(leg.model.x, liftRide(leg, f).y, leg.model.z);
  return { pos, heading: leg.model.yaw, mode: "lift", level: leg.level, walked: leg.w0 };
}

export function ribbonPath(legs: Leg3[]): { points: THREE.Vector3[]; dist: number[] } {
  const points: THREE.Vector3[] = [];
  const dist: number[] = [];
  const add = (p: THREE.Vector3, d: number) => {
    const last = points[points.length - 1];
    if (last && last.distanceToSquared(p) < 1e-6) {
      dist[dist.length - 1] = d;
      return;
    }
    points.push(p);
    dist.push(d);
  };
  for (const leg of legs) {
    if (leg.kind === "walk") {
      add(leg.a.clone().setY(leg.a.y + 0.08), leg.d0);
      add(leg.b.clone().setY(leg.b.y + 0.08), leg.d1);
    } else if (leg.kind === "ride") {
      const m = leg.model;
      for (const k of [0, m.land, m.land + m.run, m.h]) {
        const p = flightPoint(m, leg.up ? k : m.h - k, new THREE.Vector3());
        add(p.setY(p.y + 0.07), leg.d0 + ((leg.d1 - leg.d0) * k) / (m.h || 1));
      }
    } else {
      add(new THREE.Vector3(leg.model.x, leg.y0 + 0.3, leg.model.z), leg.d0);
      add(new THREE.Vector3(leg.model.x, leg.y1 + 0.3, leg.model.z), leg.d1);
    }
  }
  return { points, dist };
}
