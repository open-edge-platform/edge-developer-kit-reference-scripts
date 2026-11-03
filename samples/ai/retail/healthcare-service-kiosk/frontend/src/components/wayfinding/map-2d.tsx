// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { NODE_KIND_ICON } from "@/lib/wayfinding/categories";
import { boundsOf } from "@/lib/wayfinding/geometry";
import { positionAt, splitByLevel, type RoutePosition } from "@/lib/wayfinding/route-geometry";
import type { Route, RoutePoint } from "@/lib/wayfinding/routing";
import type { Bounds, LoadedMap, Place, Point } from "@/lib/wayfinding/types";
import { cn } from "@/lib/utils";
import { LevelChips } from "./level-chips";
import { PlaceCard } from "./place-card";

type View = { k: number; tx: number; ty: number };
type Gesture = { start: View; x: number; y: number; dist: number; anchor: { x: number; y: number }; moved: boolean };

const PAD = 4;
const MIN_K = 0.8;
const MAX_K = 24;
const MIN_FIT_SPAN = 40;
const FOLLOW_SPAN = 70;
const MIN_LABEL_PX = 11;
const MAX_LABEL_PX = 18;
export const START_COLOR = "#16a34a";
export const END_COLOR = "#dc2626";

const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

/** Pixels along each edge of the map that the page covers with its own panels. */
export type Inset = { top: number; right: number; bottom: number; left: number };
export const NO_INSET: Inset = { top: 0, right: 0, bottom: 0, left: 0 };

/** Where a route may be framed: clear of the page's panels, the floor chips on the left and the captions along the bottom. */
export function framingArea(inset: Inset): Inset {
  return { ...inset, left: inset.left + 72, bottom: inset.bottom + 56 };
}

export type MapViewProps = {
  map: LoadedMap;
  levelId: string;
  onLevelChange: (id: string) => void;
  route: Route | null;
  distance: number;
  position: RoutePosition | null;
  follow: boolean;
  startId?: string;
  onDirections?: (place: Place) => void;
  compact?: boolean;
  /** The route is framed in what the inset leaves uncovered, and the map's own buttons stay out of it. */
  inset?: Inset;
};

export function Map2D({
  map,
  levelId,
  onLevelChange,
  route,
  distance,
  position,
  follow,
  startId,
  onDirections,
  compact,
  inset = NO_INSET,
}: MapViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const level = map.levelsById.get(levelId) ?? map.levels[0];
  const b = map.bounds;
  const Y = (y: number) => b.maxY + b.minY - y;
  const vb = { x: b.minX - PAD, y: b.minY - PAD, w: b.maxX - b.minX + 2 * PAD, h: b.maxY - b.minY + 2 * PAD };
  const fitScale = size.w > 0 ? Math.min(size.w / vb.w, size.h / vb.h) : 0;
  const frame = framingArea(inset);
  const visible =
    fitScale > 0
      ? {
          w: Math.max(1, size.w - frame.left - frame.right) / fitScale,
          h: Math.max(1, size.h - frame.top - frame.bottom) / fitScale,
        }
      : { w: vb.w, h: vb.h };
  const shiftX = fitScale > 0 ? (frame.left - frame.right) / 2 / fitScale : 0;
  const shiftY = fitScale > 0 ? (frame.top - frame.bottom) / 2 / fitScale : 0;

  const centerOn = (x: number, y: number, k: number): View => ({
    k,
    tx: vb.x + vb.w / 2 + shiftX - k * x,
    ty: vb.y + vb.h / 2 + shiftY - k * Y(y),
  });
  const fitTo = (bounds: Bounds): View => {
    const w = Math.max(MIN_FIT_SPAN, bounds.maxX - bounds.minX);
    const h = Math.max(MIN_FIT_SPAN, bounds.maxY - bounds.minY);
    const k = clampK(Math.min(visible.w / w, visible.h / h) * 0.8);
    return centerOn((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, k);
  };

  const pieces = useMemo(() => (route ? splitByLevel(route) : []), [route]);
  const levelPieces = pieces.filter((piece) => piece.levelId === level.id);
  const focusBounds = (): Bounds => {
    const points: Point[] = levelPieces.flatMap((piece) => piece.points.map((p): Point => [p.x, p.y]));
    return points.length > 0 ? boundsOf(points) : level.bounds;
  };

  const [view, setView] = useState<View>({ k: 1, tx: 0, ty: 0 });
  const fitKey =
    size.w > 0
      ? `${level.id}|${route?.to.id ?? ""}|${route?.totalDistance ?? 0}|${size.w}x${size.h}|${inset.top},${inset.right},${inset.bottom},${inset.left}`
      : "";
  const [fittedKey, setFittedKey] = useState("");
  if (fitKey && fitKey !== fittedKey) {
    setFittedKey(fitKey);
    setView(fitTo(focusBounds()));
  }

  const followActive = follow && position !== null && position.levelId === level.id;
  const shown =
    followActive && position
      ? centerOn(position.x, position.y, Math.max(view.k, clampK(visible.w / FOLLOW_SPAN)))
      : view;
  const [wasFollowing, setWasFollowing] = useState(followActive);
  if (followActive !== wasFollowing) {
    setWasFollowing(followActive);
    if (!followActive && position && position.levelId === level.id) {
      setView(centerOn(position.x, position.y, Math.max(view.k, clampK(visible.w / FOLLOW_SPAN))));
    }
  }

  const [card, setCard] = useState<{ place: Place; x: number; y: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);
  const lastMoved = useRef(false);

  const toViewBox = (clientX: number, clientY: number) => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const beginGesture = (start: View, moved: boolean) => {
    const pts = [...pointers.current.values()];
    if (pts.length === 0) {
      gesture.current = null;
      return;
    }
    const [a, c = pts[0]] = pts;
    const x = (a.x + c.x) / 2;
    const y = (a.y + c.y) / 2;
    const anchor = toViewBox(x, y);
    gesture.current = anchor ? { start, x, y, dist: Math.hypot(a.x - c.x, a.y - c.y), anchor, moved } : null;
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (pointers.current.size === 0) lastMoved.current = false;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    beginGesture(shown, gesture.current?.moved ?? false);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const [a, c = pts[0]] = pts;
    const mx = (a.x + c.x) / 2;
    const my = (a.y + c.y) / 2;
    if (!g.moved && Math.abs(mx - g.x) + Math.abs(my - g.y) + Math.abs(Math.hypot(a.x - c.x, a.y - c.y) - g.dist) > 6) {
      g.moved = true;
      for (const id of pointers.current.keys()) svgRef.current?.setPointerCapture(id);
    }
    if (!g.moved) return;
    const scale = svgRef.current?.getScreenCTM()?.a;
    if (!scale) return;
    const k = pts.length > 1 && g.dist > 0 ? clampK((g.start.k * Math.hypot(a.x - c.x, a.y - c.y)) / g.dist) : g.start.k;
    const anchorX = g.anchor.x + (mx - g.x) / scale;
    const anchorY = g.anchor.y + (my - g.y) / scale;
    setView({
      k,
      tx: anchorX - (k * (g.anchor.x - g.start.tx)) / g.start.k,
      ty: anchorY - (k * (g.anchor.y - g.start.ty)) / g.start.k,
    });
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const moved = gesture.current?.moved ?? false;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      lastMoved.current = moved;
      if (!moved) setCard(null);
      gesture.current = null;
    } else {
      beginGesture(shown, moved);
    }
  };

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const ctm = el.getScreenCTM();
      if (!ctm) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      const f = Math.exp(-e.deltaY * 0.0015);
      setView((v) => {
        const k = clampK(v.k * f);
        return { k, tx: p.x - ((p.x - v.tx) * k) / v.k, ty: p.y - ((p.y - v.ty) * k) / v.k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    const k = clampK(shown.k * factor);
    const cx = vb.x + vb.w / 2;
    const cy = vb.y + vb.h / 2;
    setView({ k, tx: cx - ((cx - shown.tx) * k) / shown.k, ty: cy - ((cy - shown.ty) * k) / shown.k });
  };

  const rooms = useMemo(() => map.places.filter((p) => p.kind === "room" && p.levelId === level.id), [map, level.id]);
  const pois = useMemo(() => map.places.filter((p) => p.kind === "poi" && p.levelId === level.id), [map, level.id]);
  const connectors = (map.nodesByLevel.get(level.id) ?? []).filter((n) => n.kind !== "junction" && n.kind !== "door");

  const traveled = useMemo(() => {
    if (!route) return [] as RoutePoint[][];
    return levelPieces.map((piece) => {
      const pts = piece.points.filter((p) => route.cumulative[route.points.indexOf(p)] <= distance);
      if (distance > piece.startDistance && distance < piece.endDistance) {
        const at = positionAt(route, distance);
        pts.push({ x: at.x, y: at.y, z: at.z, levelId: at.levelId, via: "walk" });
      }
      return pts;
    });
  }, [route, levelPieces, distance]);

  const pxPerUnit = (fitScale || 4) * shown.k;
  const px = (pixels: number) => (pixels * (compact ? 0.9 : 1)) / pxPerUnit;
  const fitFont = (text: string, w: number, h: number, maxPx: number) => {
    const sizeInUnits = Math.min(w / (text.length * 0.62 + 1), h / 2.6, px(maxPx));
    return sizeInUnits * pxPerUnit >= MIN_LABEL_PX ? sizeInUnits : 0;
  };
  const detailed = pxPerUnit >= 2.5;
  const pathOf = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${Y(p.y)}`).join(" ");

  const openCard = (e: React.MouseEvent, place: Place) => {
    if (lastMoved.current) return;
    e.stopPropagation();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCard({ place, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const fromPlace = startId ? map.placesById.get(startId) : route?.from;
  const toPlace = route?.to;
  const pieceIndex = (piece: (typeof pieces)[number]) => pieces.indexOf(piece);

  return (
    <div className="relative h-full w-full overflow-hidden bg-muted select-none" data-testid="map-2d">
      <svg
        ref={svgRef}
        className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <g transform={`translate(${shown.tx} ${shown.ty}) scale(${shown.k})`}>
          <polygon
            points={pathOf(level.outline.map(([x, y]) => ({ x, y })))}
            className="fill-card stroke-border"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />

          {rooms.map((r) => {
            const isTo = r.id === toPlace?.id;
            const isFrom = r.id === fromPlace?.id;
            const box = boundsOf(r.polygon ?? []);
            const size =
              r.category === "unit"
                ? 0
                : fitFont(r.name, box.maxX - box.minX, box.maxY - box.minY, r.category === "health" ? MAX_LABEL_PX + 4 : MAX_LABEL_PX);
            return (
              <g key={r.id} className="cursor-pointer" onClick={(e) => openCard(e, r)}>
                <polygon
                  points={pathOf((r.polygon ?? []).map(([x, y]) => ({ x, y })))}
                  fill={r.color}
                  fillOpacity={isTo || isFrom ? 0.95 : r.category === "health" ? 0.85 : 0.5}
                  stroke={isTo ? END_COLOR : isFrom ? START_COLOR : undefined}
                  className={isTo || isFrom ? undefined : "stroke-card"}
                  strokeWidth={isTo || isFrom ? 3 : 1.5}
                  vectorEffect="non-scaling-stroke"
                />
                {size > 0 && (
                  <text
                    x={r.x}
                    y={Y(r.y)}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={size}
                    className="pointer-events-none fill-foreground"
                  >
                    <tspan x={r.x} dy={-size * 0.6}>
                      {r.icon}
                    </tspan>
                    <tspan x={r.x} dy={size * 1.15} fontWeight={r.category === "health" ? 800 : 600}>
                      {r.name}
                    </tspan>
                  </text>
                )}
              </g>
            );
          })}

          {detailed &&
            connectors.map((n) => (
              <g key={n.id} className="pointer-events-none">
                <rect x={n.x - px(11)} y={Y(n.y) - px(11)} width={px(22)} height={px(22)} rx={px(5)} fill="#334155" opacity={0.85} />
                <text x={n.x} y={Y(n.y)} textAnchor="middle" dominantBaseline="central" fontSize={px(13)}>
                  {NODE_KIND_ICON[n.kind] ?? "•"}
                </text>
              </g>
            ))}

          {pois.map((p) => (
            <g key={p.id} className="cursor-pointer" onClick={(e) => openCard(e, p)}>
              <circle
                cx={p.x}
                cy={Y(p.y)}
                r={px(12)}
                className="fill-card"
                stroke={p.id === toPlace?.id ? END_COLOR : p.id === fromPlace?.id ? START_COLOR : p.color}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
              <text x={p.x} y={Y(p.y)} textAnchor="middle" dominantBaseline="central" fontSize={px(13)} className="pointer-events-none">
                {p.icon}
              </text>
              {detailed && (
                <text x={p.x} y={Y(p.y) + px(26)} textAnchor="middle" fontSize={px(12)} fontWeight={600} className="pointer-events-none fill-foreground">
                  {p.name}
                </text>
              )}
            </g>
          ))}

          {route &&
            levelPieces.map((piece, i) => {
              const index = pieceIndex(piece);
              const last = piece.points[piece.points.length - 1];
              const first = piece.points[0];
              return (
                <g key={i} className="pointer-events-none">
                  <polyline points={pathOf(piece.points)} fill="none" className="stroke-primary" strokeOpacity={0.25} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  <polyline points={pathOf(piece.points)} fill="none" className="stroke-primary" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  <polyline points={pathOf(piece.points)} fill="none" className="wf-route-dash stroke-card" strokeWidth={1.5} strokeDasharray="4 6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  {traveled[i]?.length > 1 && (
                    <polyline points={pathOf(traveled[i])} fill="none" className="stroke-muted-foreground" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  )}
                  {index < pieces.length - 1 && (
                    <LevelBadge x={last.x} y={Y(last.y)} label={`To ${map.levelsById.get(pieces[index + 1].levelId)?.name ?? ""}`} px={px} />
                  )}
                  {index > 0 && (
                    <LevelBadge x={first.x} y={Y(first.y)} label={`From ${map.levelsById.get(pieces[index - 1].levelId)?.name ?? ""}`} px={px} />
                  )}
                </g>
              );
            })}

          {fromPlace && fromPlace.levelId === level.id && (
            <Pin x={fromPlace.x} y={Y(fromPlace.y)} color={START_COLOR} label="You are here" px={px} />
          )}
          {toPlace && toPlace.levelId === level.id && (
            <Pin x={toPlace.x} y={Y(toPlace.y)} color={END_COLOR} label={toPlace.name} px={px} />
          )}

          {position && position.levelId === level.id && (
            <g transform={`translate(${position.x} ${Y(position.y)})`} className="pointer-events-none">
              <circle r={px(22)} className="wf-marker-pulse fill-primary" opacity={0.25} />
              <g transform={`rotate(${position.heading})`}>
                <path d={`M0 ${-px(26)} L${px(12)} ${-px(6)} L${-px(12)} ${-px(6)} Z`} className="fill-primary" />
              </g>
              <circle r={px(10)} className="fill-primary stroke-card" strokeWidth={3} vectorEffect="non-scaling-stroke" />
            </g>
          )}
        </g>
      </svg>

      <div className="pointer-events-none absolute top-0 left-0 flex p-3" style={{ bottom: inset.bottom }}>
        <LevelChips map={map} activeId={level.id} onChange={onLevelChange} routeLevels={route?.levelsVisited} />
      </div>
      <div className="pointer-events-none absolute top-3 flex flex-col gap-2" style={{ right: inset.right + 12 }}>
        <MapButton label="Zoom in" onClick={() => zoomBy(1.5)}>
          <Plus />
        </MapButton>
        <MapButton label="Zoom out" onClick={() => zoomBy(1 / 1.5)}>
          <Minus />
        </MapButton>
        <MapButton label="Fit the route" onClick={() => setView(fitTo(focusBounds()))}>
          <Maximize2 />
        </MapButton>
      </div>
      <div
        className="pointer-events-none absolute left-20 flex max-w-[60%] flex-col gap-0.5 rounded-xl bg-card/90 px-3 py-1.5 shadow-sm"
        style={{ bottom: inset.bottom + 12 }}
      >
        <span className="text-sm font-semibold">
          {level.name}
          {level.subtitle && <span className="font-normal text-muted-foreground"> · {level.subtitle}</span>}
        </span>
        {!compact && map.attribution && (
          <span className="line-clamp-1 text-[11px] text-muted-foreground" title={map.attribution}>
            {map.attribution}
          </span>
        )}
      </div>
      <div
        className="pointer-events-none absolute flex size-11 items-center justify-center rounded-full bg-card/90 shadow-sm"
        style={{ right: inset.right + 12, bottom: inset.bottom + 12 }}
        title={`North is ${Math.round(map.upBearing)}° from map-up`}
      >
        <div style={{ transform: `rotate(${-map.upBearing}deg)` }} className="flex flex-col items-center leading-none">
          <span className="text-[10px] font-bold text-destructive">N</span>
          <span className="text-sm leading-none">▲</span>
        </div>
      </div>

      {card && (
        <div className="absolute z-20 -translate-x-1/2 -translate-y-full" style={{ left: card.x, top: card.y - 12 }}>
          <PlaceCard
            place={card.place}
            level={map.levelsById.get(card.place.levelId)}
            onDirections={
              onDirections && card.place.id !== toPlace?.id
                ? () => {
                    onDirections(card.place);
                    setCard(null);
                  }
                : undefined
            }
            onClose={() => setCard(null)}
          />
        </div>
      )}
    </div>
  );
}

export function MapButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "pointer-events-auto flex size-12 items-center justify-center rounded-xl border bg-card/95 text-foreground shadow-md transition-colors hover:bg-accent [&_svg]:size-5",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Pin({ x, y, color, label, px }: { x: number; y: number; color: string; label: string; px: (n: number) => number }) {
  const r = px(14);
  const textSize = px(15);
  const w = textSize * (label.length * 0.6 + 1.6);
  return (
    <g transform={`translate(${x} ${y})`} className="pointer-events-none">
      <path d={`M0 0 L${-r * 0.8} ${-r * 1.4} A${r} ${r} 0 1 1 ${r * 0.8} ${-r * 1.4} Z`} fill={color} stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <circle cy={-r * 1.7} r={r * 0.45} fill="#fff" />
      <rect x={-w / 2} y={-r * 3.1 - textSize * 1.6} width={w} height={textSize * 1.6} rx={textSize * 0.5} fill={color} />
      <text y={-r * 3.1 - textSize * 0.8} textAnchor="middle" dominantBaseline="central" fontSize={textSize} fontWeight={700} fill="#fff">
        {label}
      </text>
    </g>
  );
}

function LevelBadge({ x, y, label, px }: { x: number; y: number; label: string; px: (n: number) => number }) {
  const w = px(13) * (label.length * 0.6 + 1.4);
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-w / 2} y={px(14)} width={w} height={px(24)} rx={px(7)} fill="#1e293b" />
      <text y={px(26)} textAnchor="middle" dominantBaseline="central" fontSize={px(13)} fontWeight={700} fill="#fff">
        {label}
      </text>
    </g>
  );
}
