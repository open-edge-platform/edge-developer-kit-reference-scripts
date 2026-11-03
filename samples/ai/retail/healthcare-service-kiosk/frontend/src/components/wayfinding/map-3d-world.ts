// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useMemo } from "react";
import * as THREE from "three";
import { storeyHeight } from "@/lib/wayfinding/transfers";
import type { Level, LoadedMap, Point } from "@/lib/wayfinding/types";

export const SLAB = 0.3;
export const ROOM_HEIGHT = 2.6;
export const ROUTE_COLOR = "#087f78";
const EXPLODE = 4;
export type Vec3 = [number, number, number];

/**
 * Map coords → world coords (x east, y up, z south), centred on the venue.
 * Elevations are remapped piecewise-linearly so the gap added between floors
 * also stretches positions between them (lift and escalator rides). The gap
 * follows height, not floor count: a half-height mezzanine gets half a gap.
 */
export function useWorld(map: LoadedMap) {
  const { bounds, levels } = map;
  return useMemo(() => {
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const storey = storeyHeight(map);
    const base = levels[0]?.elevation ?? 0;
    const breaks = levels.map((l) => ({
      z: l.elevation,
      y: l.elevation + EXPLODE * (storey > 0 ? (l.elevation - base) / storey : l.index),
    }));
    const zToY = (z: number) => {
      if (breaks.length === 0) return z;
      if (z <= breaks[0].z) return breaks[0].y + (z - breaks[0].z);
      for (let i = 1; i < breaks.length; i++) {
        if (z <= breaks[i].z) {
          const a = breaks[i - 1];
          const b = breaks[i];
          const t = b.z === a.z ? 1 : (z - a.z) / (b.z - a.z);
          return a.y + (b.y - a.y) * t;
        }
      }
      const last = breaks[breaks.length - 1];
      return last.y + (z - last.z);
    };
    const levelY = (level: Level) => zToY(level.elevation);
    const levelAt = (y: number) => {
      const ys = breaks.map((b) => b.y + SLAB);
      if (ys.length < 2 || y <= ys[0]) return 0;
      for (let i = 1; i < ys.length; i++) if (y < ys[i]) return i - 1 + (y - ys[i - 1]) / (ys[i] - ys[i - 1]);
      return ys.length - 1;
    };
    const toWorld = (x: number, y: number, z: number, lift = 0): Vec3 => [x - cx, zToY(z) + lift, -(y - cy)];
    const shape = (poly: Point[]) => {
      const s = new THREE.Shape();
      poly.forEach(([x, y], i) => (i === 0 ? s.moveTo(x - cx, y - cy) : s.lineTo(x - cx, y - cy)));
      s.closePath();
      return s;
    };
    return { toWorld, levelY, levelAt, shape, cx, cy };
  }, [map, bounds, levels]);
}
export type World = ReturnType<typeof useWorld>;
