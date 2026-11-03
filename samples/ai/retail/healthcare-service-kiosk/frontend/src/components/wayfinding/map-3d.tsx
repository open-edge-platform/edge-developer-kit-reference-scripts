// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { MapPin, Maximize2 } from "lucide-react";
import * as THREE from "three";
import { placeBadge } from "@/hospital/place-badges";
import { boundsOf } from "@/lib/wayfinding/geometry";
import { escalatorFlights, liftShafts, tripOf } from "@/lib/wayfinding/transfers";
import type { Level, LoadedMap, Place } from "@/lib/wayfinding/types";
import { BadgeTile, EscalatorIcon, LiftIcon, PlaceBadge, RoomName, TRANSPORT_COLOR, type BadgeIcon } from "./badge";
import { FLOOR_CHIPS, LevelChips } from "./level-chips";
import { END_COLOR, MapButton, NO_INSET, START_COLOR, type MapViewProps } from "./map-2d";
import { Cameras, type Aim } from "./map-3d-camera";
import { Escalators, Lifts } from "./map-3d-transfers";
import { FloorTag, LiftDisplay, type FloorRole } from "./map-3d-floor-tags";
import { flightEnds, flightModel, pairFlights, poseAt, shaftModel, tripLegs, type Leg3 } from "./map-3d-trip";
import { RouteRibbon, Walker } from "./map-3d-walker";
import { ROOM_HEIGHT, SLAB, useWorld, type Vec3, type World } from "./map-3d-world";
import { PlaceCard } from "./place-card";

type FloorState = "focus" | "route" | "other";

/** Floors the route uses keep their rooms as faint ghosts, so the blocks around the start and destination stay readable. */
const FLOOR: Record<FloorState, { slab: number; room: number; edge: number; roomEdge: number; outline: number }> = {
  focus: { slab: 0.98, room: 1, edge: 1, roomEdge: 1, outline: 0 },
  route: { slab: 0.025, room: 0.16, edge: 0, roomEdge: 0.4, outline: 0.3 },
  other: { slab: 0, room: 0, edge: 0, roomEdge: 0, outline: 0.1 },
};
const ESCALATOR_SPOT = 12;
/** The start and destination rooms are tinted glass, so the walker stays in sight inside them. */
const ZONE_FILL = 0.24;
/** A room's name appears once its narrower side is this wide on screen, so zooming in names more rooms. */
const ROOM_NAME_MIN_PX = 34;
/** Place badges and lift or escalator icons are background: faint until they are the destination. */
const BADGE_FADE = "opacity-55";
const TAG_RISE = 1.4;
const LIFT_SIDE = 2.2;
const FLIGHT_SIDE = 1.2;

type Transfer = Exclude<Leg3, { kind: "walk" }>;
type FloorSpot = { position: Vec3; side: number };

type LabelDef = {
  id: string;
  position: Vec3;
  visible: boolean;
  node: ReactNode;
  interactive?: boolean;
  anchor?: "center" | "bottom" | "left" | "right";
  /** Metres to the right of `position` on screen (left when negative), whichever way the view has turned. */
  side?: number;
  /** Beyond this camera distance only the icon shows. */
  near?: number;
  /** Beyond this camera distance the label hides. */
  far?: number;
  /** Metres the label's room spans; the label hides while that is narrower than `minPx` on screen. */
  extent?: number;
  minPx?: number;
  /** A room name: it is dropped where it would cover another label, the higher rank keeping its place. */
  rank?: number;
};

const SHIFT: Record<NonNullable<LabelDef["anchor"]>, string> = {
  center: "-50%, -50%",
  bottom: "-50%, -100%",
  left: "0, -50%",
  right: "-100%, -50%",
};

const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);

const floorAt = (world: World, y: number) => Math.round(world.levelAt(y));

/** The floor a lift or escalator is boarded on, and the one it lets the visitor off at. */
function transferEnds(world: World, leg: Transfer): [number, number] {
  if (leg.kind === "lift") return [floorAt(world, leg.y0), floorAt(world, leg.y1)];
  return leg.up ? [leg.model.lowerLevel, leg.model.upperLevel] : [leg.model.upperLevel, leg.model.lowerLevel];
}

/**
 * Where each floor's tag stands: beside the lift shaft or escalator end the route uses on that floor, so a
 * ride passes them all. The transfer coming up next claims its floors' tags from earlier ones.
 */
function floorSpots(map: LoadedMap, world: World, legs: Leg3[], next?: Transfer): Map<number, FloorSpot> {
  const spots = new Map<number, FloorSpot>();
  const place = (leg: Transfer, claim: boolean) => {
    const [a, b] = transferEnds(world, leg);
    const floors = leg.kind === "lift" ? Array.from({ length: Math.abs(b - a) + 1 }, (_, k) => Math.min(a, b) + k) : [a, b];
    for (const i of floors) {
      const level = map.levels[i];
      if (!level || (!claim && spots.has(i))) continue;
      if (leg.kind === "lift") {
        spots.set(i, { position: [leg.model.x, world.levelY(level) + SLAB + TAG_RISE, leg.model.z], side: LIFT_SIDE });
      } else {
        const { foot, head } = flightEnds(leg.model);
        const p = i === leg.model.lowerLevel ? foot : head;
        spots.set(i, { position: [p.x, p.y + TAG_RISE, p.z], side: FLIGHT_SIDE });
      }
    }
  };
  for (const leg of legs) if (leg.kind !== "walk") place(leg, false);
  if (next) place(next, true);
  return spots;
}

function Projector({ labels, refs }: { labels: LabelDef[]; refs: React.RefObject<Map<string, HTMLDivElement>> }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const boxes: Box[] = [];
    const names: { el: HTMLDivElement; rank: number; anchor: NonNullable<LabelDef["anchor"]>; x: number; y: number }[] = [];
    for (const l of labels) {
      const el = refs.current.get(l.id);
      if (!el) continue;
      v.set(l.position[0], l.position[1], l.position[2]);
      const d = v.distanceTo(camera.position);
      if (!l.visible || (l.far && d > l.far)) {
        el.style.display = "none";
        continue;
      }
      if (l.extent && l.minPx && camera instanceof THREE.PerspectiveCamera) {
        const px = (l.extent * size.height) / (2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
        if (px < l.minPx) {
          el.style.display = "none";
          continue;
        }
      }
      v.project(camera);
      if (v.z > 1) {
        el.style.display = "none";
        continue;
      }
      const lod = l.near !== undefined && d > l.near ? "icon" : "full";
      if (el.dataset.lod !== lod) el.dataset.lod = lod;
      let x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      if (l.side && camera instanceof THREE.PerspectiveCamera) {
        x += (l.side * size.height) / (2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      }
      el.style.display = "";
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(${SHIFT[l.anchor ?? "center"]})`;
      if (l.rank !== undefined) names.push({ el, rank: l.rank, anchor: l.anchor ?? "center", x, y });
      else boxes.push({ el, anchor: l.anchor ?? "center", x, y });
    }
    // Room names give way to every other label, and to each other, largest room first.
    const taken = boxes.map(boxOf);
    for (const n of names.sort((a, b) => b.rank - a.rank)) {
      const box = boxOf(n);
      if (taken.some((t) => overlaps(box, t))) n.el.style.display = "none";
      else taken.push(box);
    }
  });
  return null;
}

type Box = { el: HTMLElement; anchor: NonNullable<LabelDef["anchor"]>; x: number; y: number };
type Rect = [number, number, number, number];

const NAME_GAP = 3;

function boxOf({ el, anchor, x, y }: Box): Rect {
  const w = el.offsetWidth + NAME_GAP;
  const h = el.offsetHeight + NAME_GAP;
  const left = anchor === "left" ? x : anchor === "right" ? x - w : x - w / 2;
  const top = anchor === "bottom" ? y - h : y - h / 2;
  return [left, top, left + w, top + h];
}

const overlaps = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

function transportSpots(world: World, transfers: ReturnType<typeof useTransfers>) {
  const spots: { id: string; levelId: string; position: Vec3; icon: BadgeIcon }[] = [];
  for (const s of transfers.shafts) {
    for (const n of s.nodes) {
      spots.push({
        id: `lift:${s.id}:${n.level}`,
        levelId: n.level,
        position: world.toWorld(s.x + s.facing[0] * 2.4, s.y + s.facing[1] * 2.4, n.elevation, SLAB + 3.2),
        icon: LiftIcon,
      });
    }
  }
  const clusters: { levelId: string; elevation: number; xs: number[]; ys: number[] }[] = [];
  for (const f of transfers.flights) {
    for (const n of [f.from, f.to]) {
      const c = clusters.find(
        (k) => k.levelId === n.level && Math.hypot(k.xs[0] - n.x, k.ys[0] - n.y) < ESCALATOR_SPOT,
      );
      if (c) {
        c.xs.push(n.x);
        c.ys.push(n.y);
      } else clusters.push({ levelId: n.level, elevation: n.elevation, xs: [n.x], ys: [n.y] });
    }
  }
  clusters.forEach((c, i) => {
    const x = c.xs.reduce((a, b) => a + b, 0) / c.xs.length;
    const y = c.ys.reduce((a, b) => a + b, 0) / c.ys.length;
    spots.push({ id: `esc:${i}`, levelId: c.levelId, position: world.toWorld(x, y, c.elevation, SLAB + 2.4), icon: EscalatorIcon });
  });
  return spots;
}

function useTransfers(map: LoadedMap, world: World) {
  return useMemo(() => {
    const flights = escalatorFlights(map);
    const shafts = liftShafts(map);
    const flightModels = new Map(flights.map((f) => [f.id, flightModel(map, world, f)]));
    pairFlights([...flightModels.values()]);
    const shaftModels = new Map(shafts.map((s) => [s.id, shaftModel(map, world, s)]));
    return { flights, shafts, flightModels, shaftModels, flightList: [...flightModels.values()], shaftList: [...shaftModels.values()] };
  }, [map, world]);
}

export function Map3D(props: MapViewProps) {
  const { map, levelId, onLevelChange, route, distance, position, follow, startId, onDirections, compact, inset = NO_INSET } = props;
  const world = useWorld(map);
  const transfers = useTransfers(map, world);
  const [showPlaces, setShowPlaces] = useState(false);
  const [selected, setSelected] = useState<Place | null>(null);
  const [aim, setAim] = useState<Aim>({ n: 0 });
  const pickLevel = (id: string) => {
    onLevelChange(id);
    setAim((a) => ({ n: a.n + 1, levelId: id }));
  };
  const labelRefs = useRef(new Map<string, HTMLDivElement>());
  const span = Math.max(map.bounds.maxX - map.bounds.minX, map.bounds.maxY - map.bounds.minY);
  const fromPlace = startId ? map.placesById.get(startId) : route?.from;
  const toPlace = route?.to;

  const legs = useMemo(
    () =>
      route
        ? tripLegs(map, world, tripOf(map, route, transfers.flights, transfers.shafts), transfers.flightModels, transfers.shaftModels)
        : [],
    [map, world, route, transfers],
  );
  const pose = useMemo(() => poseAt(legs, distance), [legs, distance]);
  const indexOf = (id: string) => map.levelsById.get(id)?.index ?? 0;
  const focus = follow && pose ? pose.level : indexOf(levelId);
  const focusId = map.levels.find((l) => l.index === focus)?.id ?? levelId;
  const routeLevels = useMemo(() => {
    const out = new Set<number>();
    for (const l of legs) {
      if (l.kind === "ride") out.add(l.model.lowerLevel).add(l.model.upperLevel);
      else if (l.kind === "lift") out.add(Math.round(world.levelAt(l.y0))).add(Math.round(world.levelAt(l.y1)));
      else out.add(l.level);
    }
    return out;
  }, [legs, world]);
  const spots = useMemo(() => transportSpots(world, transfers), [world, transfers]);

  const started = follow || position !== null;
  const at = pose && started ? floorAt(world, pose.pos.y) : indexOf(fromPlace?.levelId ?? levelId);
  const ahead = started ? distance : 0;
  const next = legs.find((l): l is Transfer => l.kind !== "walk" && ahead <= l.d1);
  const to = next ? transferEnds(world, next)[1] : undefined;
  const floorTags = useMemo(() => floorSpots(map, world, legs, next), [map, world, legs, next]);
  const passing = useMemo(() => {
    const out = new Set<number>();
    for (const l of legs) {
      if (l.kind !== "lift") continue;
      const [a, b] = transferEnds(world, l);
      for (let i = Math.min(a, b) + 1; i < Math.max(a, b); i++) out.add(i);
    }
    return out;
  }, [legs, world]);

  const labels = useMemo<LabelDef[]>(() => {
    const out: LabelDef[] = [];
    for (const s of spots) {
      out.push({
        id: s.id,
        position: s.position,
        visible: showPlaces && s.levelId === focusId,
        anchor: "bottom",
        far: 140,
        node: (
          <div className={BADGE_FADE}>
            <BadgeTile icon={s.icon} color={TRANSPORT_COLOR} ring />
          </div>
        ),
      });
    }
    for (const p of map.places) {
      if (p.id === toPlace?.id || p.id === fromPlace?.id) continue;
      const badge = placeBadge(p);
      const level = map.levelsById.get(p.levelId);
      if (!badge || !level) continue;
      const box = boundsOf(p.polygon ?? []);
      const extent = p.kind === "room" ? Math.max(box.maxX - box.minX, box.maxY - box.minY) : 0;
      const health = p.category === "health";
      out.push({
        id: `place:${p.id}`,
        position: world.toWorld(p.x, p.y, level.elevation, SLAB + (p.kind === "room" ? (p.height ?? ROOM_HEIGHT) + 0.2 : 0.6)),
        visible: showPlaces && p.levelId === focusId,
        anchor: "bottom",
        near: badge.named && !health ? 25 + extent * 1.2 : undefined,
        far: health ? 650 : badge.named ? 55 + extent * 2.5 : p.kind === "room" ? 45 + extent * 2 : 60,
        node: (
          <div className={BADGE_FADE}>
            {badge.named ? (
              <PlaceBadge icon={badge.icon} color={badge.color} name={p.name} />
            ) : (
              <BadgeTile icon={badge.icon} color={badge.color} ring />
            )}
          </div>
        ),
      });
    }
    for (const p of map.places) {
      if (p.kind !== "room" || p.category === "core" || p.levelId !== focusId || p.id === toPlace?.id || p.id === fromPlace?.id) continue;
      const level = map.levelsById.get(p.levelId);
      if (!level) continue;
      // With places shown, the always-visible pills of health departments already name their rooms.
      if (showPlaces && p.category === "health" && placeBadge(p)?.named) continue;
      const box = boundsOf(p.polygon ?? []);
      const extent = Math.min(box.maxX - box.minX, box.maxY - box.minY);
      out.push({
        id: `room:${p.id}`,
        position: world.toWorld(p.x, p.y, level.elevation, SLAB + (p.height ?? ROOM_HEIGHT) + 0.2),
        visible: true,
        anchor: "bottom",
        extent,
        minPx: ROOM_NAME_MIN_PX,
        rank: extent,
        node: <RoomName name={p.name} />,
      });
    }
    for (const level of map.levels) {
      const i = level.index;
      const shown = level.id === focusId || routeLevels.has(i);
      const spot = floorTags.get(i);
      const role: FloorRole = i === at ? "at" : i === to ? "to" : shown ? "floor" : "pass";
      out.push({
        id: `floor:${level.id}`,
        position: spot?.position ?? world.toWorld(level.bounds.minX - 1, level.bounds.maxY + 1, level.elevation, 0.5),
        side: spot?.side,
        anchor: "left",
        visible: showPlaces && (shown || passing.has(i)) && i >= focus,
        node: <FloorTag level={level} role={role} up={to !== undefined && to > at} compact={compact} />,
      });
    }
    if (fromPlace) {
      out.push({
        id: "pin:start",
        position: world.toWorld(fromPlace.x, fromPlace.y, map.levelsById.get(fromPlace.levelId)?.elevation ?? 0, SLAB + 3),
        visible: true,
        anchor: "bottom",
        node: (
          <div className="rounded-full px-2.5 py-1 text-sm font-bold whitespace-nowrap text-white shadow-md" style={{ background: START_COLOR }}>
            You are here
          </div>
        ),
      });
    }
    if (toPlace) {
      const badge = placeBadge(toPlace);
      out.push({
        id: "pin:end",
        position: world.toWorld(toPlace.x, toPlace.y, map.levelsById.get(toPlace.levelId)?.elevation ?? 0, SLAB + 3),
        visible: true,
        anchor: "bottom",
        node: <PlaceBadge icon={badge?.icon ?? MapPin} color={badge?.color ?? END_COLOR} name={toPlace.name} destination />,
      });
    }
    if (selected) {
      const level = map.levelsById.get(selected.levelId);
      out.push({
        id: "card",
        position: world.toWorld(
          selected.x,
          selected.y,
          level?.elevation ?? 0,
          SLAB + (selected.kind === "room" ? (selected.height ?? ROOM_HEIGHT) : 0) + 0.8,
        ),
        visible: true,
        interactive: true,
        anchor: "bottom",
        node: (
          <PlaceCard
            place={selected}
            level={level}
            onDirections={
              onDirections && selected.id !== toPlace?.id
                ? () => {
                    onDirections(selected);
                    setSelected(null);
                  }
                : undefined
            }
            onClose={() => setSelected(null)}
          />
        ),
      });
    }
    return out;
  }, [map, world, focus, focusId, routeLevels, spots, floorTags, passing, at, to, compact, fromPlace, toPlace, selected, onDirections, showPlaces]);

  const shown: LabelDef[] =
    started && pose?.mode === "lift" && to !== undefined
      ? [
          ...labels,
          {
            id: "lift-display",
            position: [pose.pos.x, pose.pos.y + TAG_RISE, pose.pos.z],
            visible: true,
            anchor: "right",
            side: -LIFT_SIDE,
            node: <LiftDisplay at={map.levels[at]} to={map.levels[to]} compact={compact} />,
          },
        ]
      : labels;

  return (
    <div className="relative h-full w-full overflow-hidden bg-muted" data-testid="map-3d">
      <Canvas
        camera={{ position: [span * 1.15, span * 0.95, span * 1.15], fov: 35, near: 0.5, far: span * 30 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        onPointerMissed={() => setSelected(null)}
      >
        <hemisphereLight args={["#ffffff", "#c7d2e0", 0.9]} />
        <directionalLight position={[span, span * 1.5, span * 0.5]} intensity={1.4} />
        {map.levels.map((level) => (
          <LevelGroup
            key={level.id}
            map={map}
            level={level}
            world={world}
            state={level.index === focus ? "focus" : routeLevels.has(level.index) ? "route" : "other"}
            fromId={fromPlace?.id}
            toId={toPlace?.id}
            onSelect={setSelected}
          />
        ))}
        <Escalators models={transfers.flightList} legs={legs} focus={focus} distance={distance} />
        <Lifts models={showPlaces ? transfers.shaftList : transfers.shaftList.filter((shaft) => legs.some((leg) => leg.kind === "lift" && leg.model === shaft))} legs={legs} distance={distance} startLevel={indexOf(fromPlace?.levelId ?? levelId)} />
        {legs.length > 0 && <RouteRibbon legs={legs} world={world} distance={distance} started={position !== null} focus={focus} />}
        {pose && <Walker pose={pose} moving={follow} />}
        {toPlace && (
          <DestinationBeam
            position={world.toWorld(toPlace.x, toPlace.y, map.levelsById.get(toPlace.levelId)?.elevation ?? 0, SLAB)}
          />
        )}
        <Cameras
          map={map}
          route={route}
          world={world}
          inset={inset}
          aim={aim}
          follow={follow ? (pose?.pos ?? null) : null}
          onStart={() => setSelected(null)}
        />
        <Projector labels={shown} refs={labelRefs} />
      </Canvas>

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {shown.map((l) => (
          <div
            key={l.id}
            ref={(el) => {
              if (el) labelRefs.current.set(l.id, el);
              else labelRefs.current.delete(l.id);
            }}
            className={`group absolute top-0 left-0 will-change-transform ${l.interactive ? "pointer-events-auto z-20" : ""}`}
            style={{ display: "none" }}
          >
            {l.node}
          </div>
        ))}
      </div>

      <div className="pointer-events-none absolute top-0 left-0 flex p-3" style={{ bottom: inset.bottom }}>
        <LevelChips map={map} activeId={focusId} onChange={pickLevel} routeLevels={route?.levelsVisited} />
      </div>
      {route && (
        <div className="pointer-events-none absolute top-3 flex items-center gap-2" style={{ right: inset.right + 12 }}>
          <button onClick={() => setShowPlaces(!showPlaces)} aria-pressed={showPlaces} className="pointer-events-auto flex min-h-12 items-center gap-2 rounded-xl border bg-card px-4 text-sm font-semibold shadow-sm"><MapPin className="size-4" aria-hidden />{showPlaces ? "Hide places" : "Show places"}</button>
          <MapButton label="Fit the route" onClick={() => setAim((a) => ({ n: a.n + 1 }))}>
            <Maximize2 />
          </MapButton>
        </div>
      )}
      {!compact && !follow && (
        <div
          className="pointer-events-none absolute flex justify-center px-4"
          style={{ left: inset.left + FLOOR_CHIPS, right: inset.right, bottom: inset.bottom + 4 }}
        >
          <span className="rounded-full bg-card/90 px-3.5 py-1.5 text-sm text-muted-foreground shadow-sm">
            Drag to turn · pinch to zoom
          </span>
        </div>
      )}
    </div>
  );
}

function LevelGroup({
  map,
  level,
  world,
  state,
  fromId,
  toId,
  onSelect,
}: {
  map: LoadedMap;
  level: Level;
  world: World;
  state: FloorState;
  fromId?: string;
  toId?: string;
  onSelect: (p: Place) => void;
}) {
  const y = world.levelY(level);
  const slab = useMemo(
    () => new THREE.ExtrudeGeometry(world.shape(level.outline), { depth: SLAB, bevelEnabled: false }),
    [world, level.outline],
  );
  const slabEdges = useMemo(() => new THREE.EdgesGeometry(slab), [slab]);
  const outline = useMemo(
    () =>
      new THREE.BufferGeometry().setFromPoints(
        level.outline.map(([x, py]) => new THREE.Vector3(x - world.cx, SLAB + 0.02, -(py - world.cy))),
      ),
    [world, level.outline],
  );
  useEffect(
    () => () => {
      slab.dispose();
      slabEdges.dispose();
      outline.dispose();
    },
    [slab, slabEdges, outline],
  );
  const rooms = useMemo(() => map.places.filter((p) => p.kind === "room" && p.levelId === level.id), [map, level.id]);
  const pois = useMemo(() => map.places.filter((p) => p.kind === "poi" && p.levelId === level.id), [map, level.id]);

  const mats = useMemo(() => {
    const std = (color: string) => new THREE.MeshStandardMaterial({ color, transparent: true });
    const line = (color: string) => new THREE.LineBasicMaterial({ color, transparent: true });
    const roomMats = new Map<string, { mat: THREE.MeshStandardMaterial; base: number }>();
    for (const r of rooms) {
      const base = r.category === "health" ? 0.95 : 0.7;
      const key = `${r.color}|${base}`;
      if (!roomMats.has(key)) roomMats.set(key, { mat: std(r.color), base });
    }
    const poiMats = new Map(pois.map((p) => [p.color, std(p.color)]));
    return {
      slab: new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.9, transparent: true }),
      slabEdge: line("#94a3b8"),
      outline: new THREE.LineBasicMaterial({ color: "#4f7a74", transparent: true, depthWrite: false }),
      roomEdge: line("#475569"),
      start: std(START_COLOR),
      end: std(END_COLOR),
      startEdge: line(START_COLOR),
      endEdge: line(END_COLOR),
      rooms: roomMats,
      pois: poiMats,
    };
  }, [rooms, pois]);
  useEffect(
    () => () => {
      for (const m of [mats.slab, mats.slabEdge, mats.outline, mats.roomEdge, mats.start, mats.end, mats.startEdge, mats.endEdge]) m.dispose();
      mats.rooms.forEach(({ mat }) => mat.dispose());
      mats.pois.forEach((m) => m.dispose());
    },
    [mats],
  );

  const slabRef = useRef<THREE.Mesh>(null);
  const edgesRef = useRef<THREE.LineSegments>(null);
  const outlineRef = useRef<THREE.LineLoop>(null);
  const roomsRef = useRef<THREE.Group>(null);
  const live = useRef<typeof mats | null>(null);
  const fade = useRef({ slab: -1, room: -1, edge: -1, roomEdge: -1, outline: -1, painted: null as typeof mats | null });
  useEffect(() => {
    live.current = mats;
  }, [mats]);

  useFrame((_, dt) => {
    const m = live.current;
    if (!m) return;
    const target = FLOOR[state];
    const k = fade.current;
    let changed = k.painted !== m;
    k.painted = m;
    for (const key of ["slab", "room", "edge", "roomEdge", "outline"] as const) {
      const cur = k[key];
      const next = cur < 0 ? target[key] : cur + (target[key] - cur) * ease(dt, 5);
      if (Math.abs(next - cur) > 0.001) {
        k[key] = Math.abs(next - target[key]) < 0.002 ? target[key] : next;
        changed = true;
      }
    }
    if (!changed) return;
    const fadeTo = (mat: THREE.Material, o: number) => {
      mat.opacity = o;
      mat.depthWrite = o > 0.9;
    };
    fadeTo(m.slab, k.slab);
    m.slabEdge.opacity = 0.9 * k.edge;
    m.outline.opacity = k.outline;
    m.roomEdge.opacity = 0.7 * k.roomEdge;
    m.rooms.forEach(({ mat, base }) => fadeTo(mat, base * k.room));
    m.pois.forEach((mat) => fadeTo(mat, k.room));
    // Full strength on any floor the route uses, so the start and destination outshine the ghosted rooms around them.
    const zone = Math.min(1, k.room / FLOOR.route.room);
    for (const mat of [m.start, m.end]) fadeTo(mat, ZONE_FILL * (0.4 + 0.6 * zone));
    for (const mat of [m.startEdge, m.endEdge]) mat.opacity = 0.55 + 0.45 * k.edge;
    if (slabRef.current) slabRef.current.visible = k.slab > 0.004;
    if (edgesRef.current) edgesRef.current.visible = k.edge > 0.004;
    if (outlineRef.current) outlineRef.current.visible = k.outline > 0.004;
    if (roomsRef.current) roomsRef.current.visible = k.room > 0.01;
  });

  // Only the floor on show takes taps; a handler on a ghosted floor would catch the tap on its way down.
  const select = state === "focus" ? onSelect : undefined;

  return (
    <group position={[0, y, 0]}>
      <mesh ref={slabRef} geometry={slab} rotation={[-Math.PI / 2, 0, 0]} material={mats.slab} />
      <lineSegments ref={edgesRef} geometry={slabEdges} rotation={[-Math.PI / 2, 0, 0]} material={mats.slabEdge} />
      <lineLoop ref={outlineRef} geometry={outline} material={mats.outline} />
      <group ref={roomsRef}>
        {rooms.map((r) =>
          r.id === toId || r.id === fromId ? null : (
            <Room
              key={r.id}
              place={r}
              world={world}
              material={mats.rooms.get(`${r.color}|${r.category === "health" ? 0.95 : 0.7}`)?.mat ?? mats.slab}
              edgeMaterial={mats.roomEdge}
              onSelect={select}
            />
          ),
        )}
        {pois.map((p) => (
          <mesh
            key={p.id}
            position={[p.x - world.cx, SLAB + 0.05, -(p.y - world.cy)]}
            material={mats.pois.get(p.color)}
            onClick={
              select &&
              ((e) => {
                e.stopPropagation();
                select(p);
              })
            }
          >
            <cylinderGeometry args={[0.9, 0.9, 0.1, 24]} />
          </mesh>
        ))}
      </group>
      {rooms
        .filter((r) => r.id === toId || r.id === fromId)
        .map((r) => (
          <Room
            key={r.id}
            place={r}
            world={world}
            material={r.id === toId ? mats.end : mats.start}
            edgeMaterial={r.id === toId ? mats.endEdge : mats.startEdge}
            onSelect={select}
          />
        ))}
    </group>
  );
}

function Room({
  place,
  world,
  material,
  edgeMaterial,
  onSelect,
}: {
  place: Place;
  world: World;
  material: THREE.Material;
  edgeMaterial: THREE.Material;
  onSelect?: (p: Place) => void;
}) {
  const h = place.height ?? ROOM_HEIGHT;
  const geometry = useMemo(
    () => new THREE.ExtrudeGeometry(world.shape(place.polygon ?? []), { depth: h, bevelEnabled: false }),
    [world, place.polygon, h],
  );
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry), [geometry]);
  useEffect(
    () => () => {
      geometry.dispose();
      edges.dispose();
    },
    [geometry, edges],
  );
  return (
    <group position={[0, SLAB, 0]}>
      <mesh
        geometry={geometry}
        rotation={[-Math.PI / 2, 0, 0]}
        material={material}
        onClick={
          onSelect &&
          ((e) => {
            e.stopPropagation();
            onSelect(place);
          })
        }
      />
      <lineSegments geometry={edges} rotation={[-Math.PI / 2, 0, 0]} material={edgeMaterial} />
    </group>
  );
}

function DestinationBeam({ position }: { position: Vec3 }) {
  const beam = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const mats = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 0, 128);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(1, "rgba(255,255,255,1)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 4, 128);
    }
    const fade = new THREE.CanvasTexture(canvas);
    return {
      fade,
      beam: new THREE.MeshBasicMaterial({ color: END_COLOR, map: fade, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }),
      ring: new THREE.MeshBasicMaterial({ color: END_COLOR, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }),
    };
  }, []);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (beam.current) (beam.current.material as THREE.MeshBasicMaterial).opacity = 0.1 + ((Math.sin(t * 2.4) + 1) / 2) * 0.08;
    const r = (t * 0.7) % 1;
    if (ring.current) {
      (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - r);
      ring.current.scale.setScalar(0.7 + r * 0.8);
    }
  });
  return (
    <group position={position}>
      <mesh ref={beam} position-y={ROOM_HEIGHT + 12} material={mats.beam} renderOrder={6}>
        <cylinderGeometry args={[1.6, 1.6, 24, 32, 1, true]} />
      </mesh>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.06} material={mats.ring} renderOrder={7}>
        <ringGeometry args={[2.2, 2.6, 48]} />
      </mesh>
    </group>
  );
}
