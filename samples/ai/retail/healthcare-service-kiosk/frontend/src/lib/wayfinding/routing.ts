// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { bearing, compassName as trueCompassName, turnAngle } from "./geometry";
import type { EdgeVia, GraphEdge, GraphNode, LoadedMap, Place, Point } from "./types";

export const SEARCH_METHODS = ["astar", "dijkstra"] as const;
export type SearchMethod = (typeof SEARCH_METHODS)[number];

export interface RouteOptions {
  avoid?: EdgeVia[];
  method?: SearchMethod;
}

const VIA_LABEL: Record<EdgeVia, string> = {
  walk: "walking",
  ramp: "ramp",
  stairs: "stairs",
  escalator: "escalator",
  elevator: "lift",
};

const VERTICAL: ReadonlySet<EdgeVia> = new Set(["stairs", "elevator", "escalator"]);

export interface RoutePoint {
  x: number;
  y: number;
  z: number;
  levelId: string;
  nodeId?: string;
  /** How the segment *ending* at this point is traversed. */
  via: EdgeVia;
}

export type StepKind =
  | "start"
  | "straight"
  | "left"
  | "right"
  | "slight-left"
  | "slight-right"
  | "uturn"
  | "stairs-up"
  | "stairs-down"
  | "elevator-up"
  | "elevator-down"
  | "escalator-up"
  | "escalator-down"
  | "ramp"
  | "waypoint"
  | "arrive";

export interface Step {
  kind: StepKind;
  text: string;
  /** Cumulative distance along the route where this step begins. */
  at: number;
  /** Distance covered by this step (until the next step starts). */
  distance: number;
  levelId: string;
  /** Number of floors traversed (vertical steps only). */
  floors?: number;
}

export interface Route {
  from: Place;
  to: Place;
  points: RoutePoint[];
  cumulative: number[];
  totalDistance: number;
  walkingDistance: number;
  estimatedSeconds: number;
  levelsVisited: string[];
  steps: Step[];
  cost: number;
}

export function isTransferStep(kind: StepKind): boolean {
  return kind.startsWith("stairs") || kind.startsWith("elevator") || kind.startsWith("escalator");
}

class MinHeap<T> {
  private a: { k: number; v: T }[] = [];
  get size() {
    return this.a.length;
  }
  push(k: number, v: T) {
    const a = this.a;
    a.push({ k, v });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].k <= a[i].k) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): T | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0].v;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < a.length && a[l].k < a[m].k) m = l;
        if (r < a.length && a[r].k < a[m].k) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Lower bound on the cost still to go, per search method. A* uses straight-line
 * distance (no edge costs less than its length); Dijkstra is the same search
 * with no estimate, so it expands nodes by cost from the start alone.
 */
const HEURISTIC: Record<SearchMethod, (goal: GraphNode) => (node: GraphNode) => number> = {
  astar: (goal) => (n) => Math.hypot(n.x - goal.x, n.y - goal.y, n.elevation - goal.elevation),
  dijkstra: () => () => 0,
};

function findPath(map: LoadedMap, fromNodeId: string, toNodeId: string, opts: RouteOptions = {}): GraphEdge[] | null {
  const goal = map.nodes.get(toNodeId);
  const start = map.nodes.get(fromNodeId);
  if (!goal || !start) return null;
  if (fromNodeId === toNodeId) return [];
  const avoid = new Set(opts.avoid ?? []);

  const estimate = HEURISTIC[opts.method ?? "astar"](goal);
  const h = (id: string) => estimate(map.nodes.get(id)!);

  const g = new Map<string, number>([[fromNodeId, 0]]);
  const cameFrom = new Map<string, GraphEdge>();
  const closed = new Set<string>();
  const open = new MinHeap<string>();
  open.push(h(fromNodeId), fromNodeId);

  while (open.size) {
    const cur = open.pop()!;
    if (cur === toNodeId) {
      const path: GraphEdge[] = [];
      let n = cur;
      while (cameFrom.has(n)) {
        const e = cameFrom.get(n)!;
        path.push(e);
        n = e.from;
      }
      return path.reverse();
    }
    if (closed.has(cur)) continue;
    closed.add(cur);
    const gCur = g.get(cur)!;
    for (const e of map.adjacency.get(cur) ?? []) {
      if (avoid.has(e.via)) continue;
      const tentative = gCur + e.cost;
      if (tentative < (g.get(e.to) ?? Infinity)) {
        g.set(e.to, tentative);
        cameFrom.set(e.to, e);
        open.push(tentative + h(e.to), e.to);
      }
    }
  }
  return null;
}

const TRANSFER_SECONDS: Record<EdgeVia, number> = { walk: 0, ramp: 0, stairs: 15, escalator: 20, elevator: 35 };
const WALK_SPEED = 1.3; // m/s

interface LegPoints {
  from: Place;
  to: Place;
  points: RoutePoint[];
  cost: number;
}

function buildLeg(map: LoadedMap, from: Place, to: Place, opts: RouteOptions): LegPoints | null {
  const path = findPath(map, from.nodeId, to.nodeId, opts);
  if (!path) return null;

  const points: RoutePoint[] = [];
  const push = (p: RoutePoint) => {
    const last = points[points.length - 1];
    if (last && last.levelId === p.levelId && Math.hypot(last.x - p.x, last.y - p.y) < 0.3) {
      if (p.nodeId && !last.nodeId) last.nodeId = p.nodeId;
      return;
    }
    points.push(p);
  };
  const elev = (levelId: string) => map.levelsById.get(levelId)?.elevation ?? 0;

  push({ x: from.x, y: from.y, z: elev(from.levelId), levelId: from.levelId, via: "walk" });
  const startNode = map.nodes.get(from.nodeId)!;
  push({ x: startNode.x, y: startNode.y, z: startNode.elevation, levelId: startNode.level, nodeId: startNode.id, via: "walk" });
  for (const e of path) {
    const n = map.nodes.get(e.to)!;
    push({ x: n.x, y: n.y, z: n.elevation, levelId: n.level, nodeId: n.id, via: e.via });
  }
  push({ x: to.x, y: to.y, z: elev(to.levelId), levelId: to.levelId, via: "walk" });

  return { from, to, points, cost: path.reduce((s, e) => s + e.cost, 0) };
}

function planTrip(map: LoadedMap, stopIds: string[], opts: RouteOptions = {}): Route | null {
  const stops = stopIds.map((id) => map.placesById.get(id));
  if (stops.length < 2 || stops.some((s) => !s)) return null;
  const places = stops as Place[];

  const legs: LegPoints[] = [];
  for (let i = 0; i < places.length - 1; i++) {
    const leg = buildLeg(map, places[i], places[i + 1], opts);
    if (!leg) return null;
    legs.push(leg);
  }
  return assemble(map, places, legs);
}

export function findRoute(map: LoadedMap, fromPlaceId: string, toPlaceId: string, opts: RouteOptions = {}): Route | null {
  return planTrip(map, [fromPlaceId, toPlaceId], opts);
}

function assemble(map: LoadedMap, stops: Place[], legs: LegPoints[]): Route {
  const points: RoutePoint[] = [];
  const legStartIdx: number[] = [];
  for (const leg of legs) {
    legStartIdx.push(points.length === 0 ? 0 : points.length - 1);
    const slice = points.length === 0 ? leg.points : leg.points.slice(1);
    points.push(...slice);
  }

  const cumulative = [0];
  let walkingDistance = 0;
  let transferSeconds = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    cumulative.push(cumulative[i - 1] + d);
    if (VERTICAL.has(b.via)) transferSeconds += TRANSFER_SECONDS[b.via];
    else walkingDistance += d;
  }
  const totalDistance = cumulative[cumulative.length - 1];

  const steps: Step[] = [];
  legs.forEach((leg, li) => {
    const startIdx = legStartIdx[li];
    const endIdx = li + 1 < legs.length ? legStartIdx[li + 1] : points.length - 1;
    const pts = points.slice(startIdx, endIdx + 1);
    const cum = cumulative.slice(startIdx, endIdx + 1);
    const legSteps = buildSteps(map, pts, cum, leg.to, {
      continuing: li > 0,
      stopNumber: li + 1 < legs.length ? li + 1 : undefined,
    });
    steps.push(...legSteps);
  });
  steps.forEach((s, i) => {
    s.distance = (i + 1 < steps.length ? steps[i + 1].at : totalDistance) - s.at;
  });

  const levelsVisited: string[] = [];
  for (const p of points) if (levelsVisited[levelsVisited.length - 1] !== p.levelId) levelsVisited.push(p.levelId);

  return {
    from: stops[0],
    to: stops[stops.length - 1],
    points,
    cumulative,
    totalDistance,
    walkingDistance,
    estimatedSeconds: walkingDistance / WALK_SPEED + transferSeconds,
    levelsVisited,
    steps,
    cost: legs.reduce((s, l) => s + l.cost, 0),
  };
}

function buildSteps(
  map: LoadedMap,
  pts: RoutePoint[],
  cum: number[],
  to: Place,
  ctx: { continuing: boolean; stopNumber?: number },
): Step[] {
  const steps: Omit<Step, "distance">[] = [];
  const n = pts.length;
  const levelName = (id: string) => map.levelsById.get(id)?.name ?? id;
  const P = (p: RoutePoint): Point => [p.x, p.y];
  // The map's +y axis may not be north.
  const compassName = (mapBearing: number) => trueCompassName(mapBearing + map.upBearing);
  const arriveKind: StepKind = ctx.stopNumber ? "waypoint" : "arrive";
  const arriveLabel = ctx.stopNumber ? `Stop ${ctx.stopNumber}: ${to.name}` : `Arrive at ${to.name}`;

  if (n < 2) {
    return [{ kind: arriveKind, text: ctx.stopNumber ? arriveLabel : `You are already at ${to.name}`, at: cum[0] ?? 0, distance: 0, levelId: to.levelId }];
  }

  const firstHorizontal = pts.findIndex((p, i) => i > 0 && !VERTICAL.has(p.via) && cum[i] - cum[i - 1] > 0.3);
  const startHeading = firstHorizontal > 0 ? bearing(P(pts[firstHorizontal - 1]), P(pts[firstHorizontal])) : 0;
  steps.push({
    kind: "start",
    text: `${ctx.continuing ? "Continue: head" : "Head"} ${compassName(startHeading)} on ${levelName(pts[0].levelId)}`,
    at: cum[0],
    levelId: pts[0].levelId,
  });

  let lastBearing = startHeading;
  let turnedAt = 0;
  let quietAt = 0;
  for (let i = 1; i < n - 1; i++) {
    const cur = pts[i],
      next = pts[i + 1];

    if (VERTICAL.has(next.via)) {
      const up = next.z > cur.z;
      const via = next.via;
      const kind = `${via}-${up ? "up" : "down"}` as StepKind;
      const label = `the ${VIA_LABEL[via]}`;
      // Floors crossed ≈ elevation change / typical floor height (so mezzanines don't count as full floors)
      const hop = Math.max(1, Math.round(Math.abs(next.z - cur.z) / typicalFloorHeight(map)));
      const prevStep = steps[steps.length - 1];
      if (prevStep && prevStep.kind === kind && VERTICAL.has(cur.via)) {
        prevStep.floors = (prevStep.floors ?? 1) + hop;
        prevStep.text = `Take ${label} ${up ? "up" : "down"} ${prevStep.floors} floors to ${levelName(next.levelId)}`;
      } else {
        const floorsText = hop > 1 ? ` ${hop} floors` : "";
        steps.push({ kind, text: `Take ${label} ${up ? "up" : "down"}${floorsText} to ${levelName(next.levelId)}`, at: cum[i], levelId: cur.levelId, floors: hop });
      }
      continue;
    }
    if (VERTICAL.has(cur.via)) {
      if (cum[i + 1] - cum[i] < 0.3) continue;
      // A short step out of a lift to the corridor is part of leaving it: head the way the corridor goes
      const stepOut = i + 2 < n - 1 && cum[i + 1] - cum[i] < LOOK_AHEAD && !VERTICAL.has(pts[i + 2].via);
      const b = stepOut ? bearing(P(next), P(pts[i + 2])) : bearing(P(cur), P(next));
      if (stepOut) turnedAt = quietAt = i + 1;
      lastBearing = b;
      steps.push({ kind: "straight", text: `Exit and head ${compassName(b)}`, at: cum[i], levelId: cur.levelId });
      continue;
    }

    const segLen = cum[i] - cum[i - 1];
    const nextLen = cum[i + 1] - cum[i];
    if (segLen < 0.3 || nextLen < 0.3) continue;

    // Look a few metres back/ahead so dense graphs with tiny wiggles don't produce noise; never back past the last turn
    let j = i - 1;
    while (j > turnedAt && cum[i] - cum[j] < LOOK_AHEAD && !VERTICAL.has(pts[j].via)) j--;
    let k = i + 1;
    while (k < n - 2 && cum[k] - cum[i] < LOOK_AHEAD && !VERTICAL.has(pts[k + 1].via)) k++;
    const bIn = bearing(P(pts[j]), P(cur));
    const bOut = bearing(P(cur), P(pts[k]));
    const turn = turnAngle(bIn, bOut);

    if (i === n - 2) {
      lastBearing = bIn;
      continue;
    }
    lastBearing = bOut;

    if (i === quietAt || Math.abs(turn) < 25) continue;
    turnedAt = i;
    // Stepping round into a lift or onto an escalator is part of taking it
    if (VERTICAL.has(pts[i + 2].via) && nextLen < LOOK_AHEAD) continue;
    const at = map.nodes.get(cur.nodeId ?? "");
    const prevStep = steps[steps.length - 1] as (Omit<Step, "distance"> & { angle?: number; from?: number }) | undefined;
    if (prevStep?.from !== undefined && cum[i] - prevStep.at < MERGE_WINDOW) {
      // Two turns within a few metres: one manoeuvre, from the heading before the first to the heading after the second
      prevStep.angle = turnAngle(prevStep.from, bOut);
      if (Math.abs(prevStep.angle) < 25) steps.pop();
      else Object.assign(prevStep, describeTurn(prevStep.angle, at?.name));
      continue;
    }
    steps.push({ ...describeTurn(turn, at?.name), at: cum[i], levelId: cur.levelId, angle: turn, from: bIn } as Omit<Step, "distance">);
  }

  let side = "";
  if (n >= 3) {
    const a = pts[n - 2],
      b = pts[n - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) > 0.3) {
      const t = turnAngle(lastBearing, bearing(P(a), P(b)));
      if (t > 30) side = " on your right";
      else if (t < -30) side = " on your left";
    }
  }
  steps.push({ kind: arriveKind, text: `${arriveLabel}${side}`, at: cum[n - 1], levelId: pts[n - 1].levelId });

  return steps.map((s) => ({ ...s, distance: 0 }));
}

function typicalFloorHeight(map: LoadedMap): number {
  const hs = map.levels.map((l) => l.height).sort((a, b) => a - b);
  return hs.length ? Math.max(2.5, hs[Math.floor(hs.length / 2)]) : 4;
}

const LOOK_AHEAD = 5; // metres used to measure the direction before/after a node
const MERGE_WINDOW = 10; // turns closer than this are merged into one manoeuvre

function describeTurn(angle: number, nodeName?: string): { kind: StepKind; text: string } {
  const abs = Math.abs(angle);
  const right = angle > 0;
  let kind: StepKind;
  let text: string;
  if (abs >= 150) {
    kind = "uturn";
    text = "Make a U-turn";
  } else if (abs >= 60) {
    kind = right ? "right" : "left";
    text = right ? "Turn right" : "Turn left";
  } else {
    kind = right ? "slight-right" : "slight-left";
    text = right ? "Bear right" : "Bear left";
  }
  if (nodeName) text += ` at ${nodeName}`;
  return { kind, text };
}

export function activeStepIndex(route: Route, distance: number): number {
  let idx = 0;
  for (let i = 0; i < route.steps.length; i++) {
    if (route.steps[i].at <= distance + 1e-6) idx = i;
    else break;
  }
  return idx;
}
