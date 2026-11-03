// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Route, RoutePoint } from "./routing";
import type { GraphNode, LoadedMap, Point } from "./types";

/** One escalator between two neighbouring stops, boarded at `from`. */
export interface Flight {
  id: string;
  from: GraphNode;
  to: GraphNode;
}

export interface Shaft {
  id: string;
  x: number;
  y: number;
  /** Lowest floor first. */
  nodes: GraphNode[];
  /** Unit vector (map x/y) from the shaft towards its landing. */
  facing: Point;
}

export type TripPiece =
  | { kind: "walk"; from: RoutePoint; to: RoutePoint; d0: number; d1: number }
  | { kind: "ride"; flight: Flight; board: GraphNode; alight: GraphNode; d0: number; d1: number }
  | { kind: "lift"; shaft: Shaft; from: RoutePoint; to: RoutePoint; d0: number; d1: number };

type Piece = TripPiece extends infer P ? (P extends unknown ? Omit<P, "d0" | "d1"> : never) : never;

const BANK = /^(.*)-([UD])-([IO])$/;
const SAME_SHAFT = 3;
const NEXT_FLIGHT = 15;

const levelIndex = (map: LoadedMap, levelId: string) => map.levelsById.get(levelId)?.index ?? 0;

/** The usual floor-to-floor height: the median gap between neighbouring levels. */
export function storeyHeight(map: LoadedMap): number {
  const gaps = map.levels
    .slice(1)
    .map((l, i) => l.elevation - map.levels[i].elevation)
    .filter((g) => g > 0)
    .sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] ?? 0;
}

const nodePoint = (n: GraphNode): RoutePoint => ({ x: n.x, y: n.y, z: n.elevation, levelId: n.level, nodeId: n.id, via: "walk" });

/**
 * Escalator data names landings "<bank>-<U|D>-<I|O>" (boarding/alighting) and links every boarding landing to
 * every floor it can reach; a flight is a boarding landing and the nearest alighting one in its direction.
 * Unnamed escalator nodes fall back to edges between neighbouring floors.
 */
export function escalatorFlights(map: LoadedMap): Flight[] {
  const index = (n: GraphNode) => levelIndex(map, n.level);
  const linked = new Set(map.edges.map((e) => `${e.from}>${e.to}`));
  const banks = new Map<string, { up: boolean; on: GraphNode[]; off: GraphNode[] }>();
  const loose = new Set<string>();
  for (const n of map.nodes.values()) {
    if (n.kind !== "escalator") continue;
    const m = BANK.exec(n.name ?? "");
    if (!m) {
      loose.add(n.id);
      continue;
    }
    const key = `${m[1]}-${m[2]}`;
    const bank = banks.get(key) ?? { up: m[2] === "U", on: [], off: [] };
    (m[3] === "I" ? bank.on : bank.off).push(n);
    banks.set(key, bank);
  }

  const tallest = 1.5 * (storeyHeight(map) || Infinity);
  const flights: Flight[] = [];
  for (const { up, on, off } of banks.values()) {
    for (const from of on) {
      const k = index(from);
      const to = off
        .filter((o) => (up ? index(o) > k : index(o) < k))
        .sort((a, b) => Math.abs(index(a) - k) - Math.abs(index(b) - k))[0];
      // A bank missing a landing would otherwise pair across a whole floor in one short flight.
      if (to && Math.abs(to.elevation - from.elevation) > tallest) continue;
      if (to && (linked.has(`${from.id}>${to.id}`) || linked.has(`${to.id}>${from.id}`))) {
        flights.push({ id: `${from.id}>${to.id}`, from, to });
      }
    }
  }

  const seen = new Set<string>();
  for (const e of map.edges) {
    if (e.via !== "escalator" || !loose.has(e.from) || !loose.has(e.to)) continue;
    const from = map.nodes.get(e.from);
    const to = map.nodes.get(e.to);
    const key = [e.from, e.to].sort().join("|");
    if (!from || !to || seen.has(key) || Math.abs(index(from) - index(to)) !== 1) continue;
    seen.add(key);
    flights.push({ id: `${from.id}>${to.id}`, from, to });
  }
  return flights;
}

/** Lift nodes stacked at one spot, one shaft each, with the side their doors open onto. */
export function liftShafts(map: LoadedMap): Shaft[] {
  const shafts: Shaft[] = [];
  for (const n of map.nodes.values()) {
    if (n.kind !== "elevator") continue;
    const shaft = shafts.find((s) => Math.hypot(s.x - n.x, s.y - n.y) < SAME_SHAFT);
    if (shaft) shaft.nodes.push(n);
    else shafts.push({ id: n.id, x: n.x, y: n.y, nodes: [n], facing: [0, -1] });
  }
  for (const s of shafts) {
    s.x = s.nodes.reduce((a, n) => a + n.x, 0) / s.nodes.length;
    s.y = s.nodes.reduce((a, n) => a + n.y, 0) / s.nodes.length;
    s.nodes.sort((a, b) => levelIndex(map, a.level) - levelIndex(map, b.level));
    let fx = 0;
    let fy = 0;
    for (const n of s.nodes) {
      for (const e of map.adjacency.get(n.id) ?? []) {
        const m = e.via === "walk" ? map.nodes.get(e.to) : undefined;
        const l = m ? Math.hypot(m.x - s.x, m.y - s.y) : 0;
        if (m && l > 0.1) {
          fx += (m.x - s.x) / l;
          fy += (m.y - s.y) / l;
        }
      }
    }
    const l = Math.hypot(fx, fy);
    if (l > 0.1) s.facing = [fx / l, fy / l];
  }
  return shafts;
}

/** The escalators ridden between two route points, with the walks between landings. Escalator edges are not one-way. */
function escalatorChain(map: LoadedMap, flights: Flight[], a: RoutePoint, b: RoutePoint): Piece[] | null {
  const index = (levelId: string) => levelIndex(map, levelId);
  const target = index(b.levelId);
  const up = target > index(a.levelId);
  const pieces: Piece[] = [];
  let at = a;
  for (let guard = 0; guard < 24 && index(at.levelId) !== target; guard++) {
    const here = index(at.levelId);
    let best: { flight: Flight; board: GraphNode; alight: GraphNode; cost: number } | null = null;
    for (const flight of flights) {
      for (const [board, alight] of [
        [flight.from, flight.to],
        [flight.to, flight.from],
      ]) {
        const there = index(alight.level);
        if (board.level !== at.levelId || there > here !== up || (up ? there > target : there < target)) continue;
        const gap = board.id === at.nodeId ? 0 : Math.hypot(board.x - at.x, board.y - at.y);
        if (gap > NEXT_FLIGHT) continue;
        const cost = gap - (alight.id === b.nodeId ? NEXT_FLIGHT : 0);
        if (!best || cost < best.cost) best = { flight, board, alight, cost };
      }
    }
    if (!best) return null;
    const board = nodePoint(best.board);
    if (Math.hypot(board.x - at.x, board.y - at.y) > 0.05) pieces.push({ kind: "walk", from: at, to: board });
    pieces.push({ kind: "ride", flight: best.flight, board: best.board, alight: best.alight });
    at = nodePoint(best.alight);
  }
  if (index(at.levelId) !== target) return null;
  if (Math.hypot(b.x - at.x, b.y - at.y) > 0.05) pieces.push({ kind: "walk", from: at, to: b });
  return pieces;
}

const pieceLength = (p: Piece) => {
  if (p.kind === "ride") {
    const { from, to } = p.flight;
    return Math.hypot(from.x - to.x, from.y - to.y, from.elevation - to.elevation);
  }
  return Math.hypot(p.from.x - p.to.x, p.from.y - p.to.y, p.from.z - p.to.z);
};

/** The route as it is travelled: walks, single escalator flights and lift rides, each with its stretch of route distance. */
export function tripOf(map: LoadedMap, route: Route, flights: Flight[], shafts: Shaft[]): TripPiece[] {
  const trip: TripPiece[] = [];
  const { points, cumulative } = route;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d0 = cumulative[i - 1];
    const d1 = cumulative[i];
    let pieces: Piece[] | null = null;
    if (b.via === "escalator") pieces = escalatorChain(map, flights, a, b);
    if (b.via === "elevator") {
      const shaft = shafts.find((s) => s.nodes.some((n) => n.id === b.nodeId));
      if (shaft) pieces = [{ kind: "lift", shaft, from: a, to: b }];
    }
    pieces = pieces ?? [{ kind: "walk", from: a, to: b }];
    const lengths = pieces.map(pieceLength);
    const total = lengths.reduce((s, l) => s + l, 0) || 1;
    let d = d0;
    pieces.forEach((p, j) => {
      const next = j === pieces.length - 1 ? d1 : d + ((d1 - d0) * lengths[j]) / total;
      trip.push({ ...p, d0: d, d1: next } as TripPiece);
      d = next;
    });
  }
  return trip;
}
