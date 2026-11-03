// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { bearing, lerp } from "./geometry";
import type { Route, RoutePoint } from "./routing";

export interface RoutePosition {
  x: number;
  y: number;
  z: number;
  levelId: string;
  heading: number;
  segment: number;
  transferring: boolean;
}

export function positionAt(route: Route, distance: number): RoutePosition {
  const { points, cumulative } = route;
  const d = Math.max(0, Math.min(route.totalDistance, distance));
  let i = 1;
  while (i < points.length - 1 && cumulative[i] < d) i++;
  const a = points[i - 1];
  const b = points[i] ?? a;
  const len = cumulative[i] - cumulative[i - 1];
  const t = len > 0 ? (d - cumulative[i - 1]) / len : 1;
  const vertical = b.via !== "walk" && b.via !== "ramp";

  let heading = lastHorizontalHeading(points, i);
  const horizontal = Math.hypot(b.x - a.x, b.y - a.y);
  if (!vertical && horizontal > 0.05) heading = bearing([a.x, a.y], [b.x, b.y]);

  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
    levelId: t < 0.5 ? a.levelId : b.levelId,
    heading,
    segment: i - 1,
    transferring: vertical && a.levelId !== b.levelId,
  };
}

function lastHorizontalHeading(points: RoutePoint[], upTo: number): number {
  for (let j = upTo; j >= 1; j--) {
    const a = points[j - 1],
      b = points[j];
    if (Math.hypot(b.x - a.x, b.y - a.y) > 0.05) return bearing([a.x, a.y], [b.x, b.y]);
  }
  return 0;
}

export interface LevelPolyline {
  levelId: string;
  points: RoutePoint[];
  startDistance: number;
  endDistance: number;
}

export function splitByLevel(route: Route): LevelPolyline[] {
  const out: LevelPolyline[] = [];
  let cur: LevelPolyline | null = null;
  route.points.forEach((p, i) => {
    if (!cur || cur.levelId !== p.levelId) {
      cur = { levelId: p.levelId, points: [p], startDistance: route.cumulative[i], endDistance: route.cumulative[i] };
      out.push(cur);
    } else {
      cur.points.push(p);
      cur.endDistance = route.cumulative[i];
    }
  });
  return out;
}
