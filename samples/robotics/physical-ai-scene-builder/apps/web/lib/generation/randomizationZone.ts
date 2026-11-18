// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Geometry of the Generate randomization zone drawn in the viewport. The zone is the rectangle of
 * start positions the object can be placed at: the authored position plus the X/Y offset ranges.
 * Ranges stay stored as centimetre strings (see `generationSettings.ts`); the zone works in metres
 * relative to the authored position.
 */
import type { RangeFields } from './generationSettings';

/** Offset rectangle in metres, relative to the object's authored position. */
export interface ZoneRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface YawRange {
  minRad: number;
  maxRad: number;
}

/** Smallest zone side a drag can produce, in metres (5 mm). */
export const MIN_ZONE_SIZE_M = 0.005;

function parse(value: string): number | null {
  if (value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** The zone for X/Y ranges in centimetres, or null while either range is incomplete or inverted. */
export function zoneFromRanges(xRange: RangeFields, yRange: RangeFields): ZoneRect | null {
  const values = [xRange.min, xRange.max, yRange.min, yRange.max].map(parse);
  if (values.some((value) => value === null)) return null;
  const [minX, maxX, minY, maxY] = (values as number[]).map((cm) => cm / 100);
  if (minX > maxX || minY > maxY) return null;
  return { minX, maxX, minY, maxY };
}

export function yawFromRange(yawRange: RangeFields): YawRange | null {
  const min = parse(yawRange.min);
  const max = parse(yawRange.max);
  if (min === null || max === null || min > max) return null;
  return { minRad: (min * Math.PI) / 180, maxRad: (max * Math.PI) / 180 };
}

/** Centimetre string rounded to 0.1 cm, without a trailing `.0` or a negative zero. */
export function formatCm(metres: number): string {
  const tenths = Math.round(metres * 1000);
  return String(tenths / 10 || 0);
}

export function rangesFromZone(zone: ZoneRect): { xRange: RangeFields; yRange: RangeFields } {
  return {
    xRange: { min: formatCm(zone.minX), max: formatCm(zone.maxX) },
    yRange: { min: formatCm(zone.minY), max: formatCm(zone.maxY) },
  };
}

/** The zone moved by a whole offset, keeping its size. */
export function moveZone(zone: ZoneRect, dx: number, dy: number): ZoneRect {
  return { minX: zone.minX + dx, maxX: zone.maxX + dx, minY: zone.minY + dy, maxY: zone.maxY + dy };
}

/**
 * The zone with one corner dragged to `point` (an offset in metres). `corner` says which corner:
 * -1 for the min side, 1 for the max side, per axis. The opposite corner stays put and the zone
 * never gets smaller than `MIN_ZONE_SIZE_M`.
 */
export function resizeZone(
  zone: ZoneRect,
  corner: readonly [-1 | 1, -1 | 1],
  point: readonly [number, number],
): ZoneRect {
  const [cornerX, cornerY] = corner;
  const [x, y] = point;
  return {
    minX: cornerX < 0 ? Math.min(x, zone.maxX - MIN_ZONE_SIZE_M) : zone.minX,
    maxX: cornerX > 0 ? Math.max(x, zone.minX + MIN_ZONE_SIZE_M) : zone.maxX,
    minY: cornerY < 0 ? Math.min(y, zone.maxY - MIN_ZONE_SIZE_M) : zone.minY,
    maxY: cornerY > 0 ? Math.max(y, zone.minY + MIN_ZONE_SIZE_M) : zone.maxY,
  };
}

export interface ZoneSample {
  x: number;
  y: number;
  yaw: number;
}

/** Deterministic pseudo-random generator (mulberry32), so the preview does not flicker. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Example start poses inside the zone, the same set every time for the same count and seed. */
export function previewSamples(
  zone: ZoneRect,
  yaw: YawRange | null,
  count: number,
  seed = 7,
): ZoneSample[] {
  const next = random(seed);
  const lerp = (min: number, max: number) => min + (max - min) * next();
  return Array.from({ length: count }, () => ({
    x: lerp(zone.minX, zone.maxX),
    y: lerp(zone.minY, zone.maxY),
    yaw: yaw ? lerp(yaw.minRad, yaw.maxRad) : 0,
  }));
}

/** Short size label, for example `4 × 4 cm`. */
export function zoneSizeLabel(zone: ZoneRect): string {
  return `${formatCm(zone.maxX - zone.minX)} × ${formatCm(zone.maxY - zone.minY)} cm`;
}

/**
 * Offsets in centimetres, relative to `objectPosition`, that cover the same world rectangle as the
 * zone `xCm`/`yCm` around `mainPosition`. Used so another object can scatter in the main zone.
 */
export function sharedZoneOffsetsCm(
  mainPosition: readonly number[],
  objectPosition: readonly number[],
  xCm: readonly [number, number],
  yCm: readonly [number, number],
): { xCm: [number, number]; yCm: [number, number] } {
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const dx = (mainPosition[0] - objectPosition[0]) * 100;
  const dy = (mainPosition[1] - objectPosition[1]) * 100;
  return {
    xCm: [round(xCm[0] + dx), round(xCm[1] + dx)],
    yCm: [round(yCm[0] + dy), round(yCm[1] + dy)],
  };
}

/** Zone colours: the main object first, then each extra object in list order. */
export const ZONE_COLORS = [
  '#38bdf8',
  '#a78bfa',
  '#34d399',
  '#f472b6',
  '#facc15',
  '#fb923c',
] as const;

export function zoneColor(index: number): string {
  return ZONE_COLORS[index % ZONE_COLORS.length];
}
