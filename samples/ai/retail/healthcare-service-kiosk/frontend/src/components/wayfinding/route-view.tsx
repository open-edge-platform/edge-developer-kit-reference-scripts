// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  Accessibility,
  ArrowUp,
  ArrowUpDown,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  Footprints,
  MapPin,
  Navigation,
  Pause,
  Play,
  RotateCcw,
  TrendingDown,
  TrendingUp,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { asHospital, HOSPITAL_MAP, kioskPlace, routeToTarget, type RouteTarget } from "@/hospital/wayfinding";
import { formatDistance, formatDuration } from "@/lib/wayfinding/geometry";
import { fetchMap } from "@/lib/wayfinding/map-loader";
import { positionAt } from "@/lib/wayfinding/route-geometry";
import { activeStepIndex, isTransferStep, type Route, type StepKind } from "@/lib/wayfinding/routing";
import type { EdgeVia, LoadedMap, Place } from "@/lib/wayfinding/types";
import { useRouteAnimation, type RouteAnimation } from "@/lib/wayfinding/use-route-animation";
import { cn } from "@/lib/utils";
import { FLOOR_CHIPS } from "./level-chips";
import { Map2D, NO_INSET, type Inset } from "./map-2d";

const Map3D = dynamic(() => import("./map-3d").then((m) => m.Map3D), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-muted text-base text-muted-foreground">
      Loading 3D view…
    </div>
  ),
});

export type ViewMode = "2d" | "3d" | "split";

const WALK_THROUGH_SPEED = 5;
const WALK_ROW = 92;
const RIDE_PACE: Partial<Record<EdgeVia, number>> = { escalator: 0.35, elevator: 0.3 };

let pending: Promise<LoadedMap> | null = null;
function loadHospitalMap(): Promise<LoadedMap> {
  pending = pending ?? fetchMap(HOSPITAL_MAP)
    .then(asHospital)
    .catch((error: unknown) => {
      pending = null;
      throw error;
    });
  return pending;
}

/** The hospital map, fetched once per page; `missing` when public/maps has none. */
export function useHospitalMap(): { map: LoadedMap | null; missing: boolean } {
  const [state, setState] = useState<{ map: LoadedMap | null; missing: boolean }>({ map: null, missing: false });
  useEffect(() => {
    let live = true;
    loadHospitalMap().then(
      (map) => live && setState({ map, missing: false }),
      () => live && setState({ map: null, missing: true }),
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}

export type HospitalRoute = {
  map: LoadedMap;
  route: Route | null;
  target: RouteTarget;
  startId?: string;
  anim: RouteAnimation;
  activeStep: number;
  levelId: string;
  setLevelId: (id: string) => void;
  goTo: (target: RouteTarget) => void;
  mapProps: React.ComponentProps<typeof Map2D>;
};

/**
 * `goTo` re-routes to another place (a room tapped on the map, a search result) until `destinationId` changes.
 * `loop` walks the route on its own, over and over — see useRouteAnimation.
 */
export function useHospitalRoute(map: LoadedMap, destinationId: string, stepFree: boolean, loop = false): HospitalRoute {
  const startId = kioskPlace(map);
  const [target, setTarget] = useState<RouteTarget>({ destinationId });
  const [given, setGiven] = useState(destinationId);
  if (destinationId !== given) {
    setGiven(destinationId);
    setTarget({ destinationId });
  }

  const route = useMemo(() => routeToTarget(map, target, stepFree), [map, target, stepFree]);

  const pace = useMemo(
    () => (route ? (d: number) => RIDE_PACE[route.points[positionAt(route, d).segment + 1]?.via ?? "walk"] ?? 1 : undefined),
    [route],
  );
  const anim = useRouteAnimation(route, WALK_THROUGH_SPEED, pace, loop);
  const position = useMemo(() => (route ? positionAt(route, anim.distance) : null), [route, anim.distance]);
  const activeStep = route ? activeStepIndex(route, anim.distance) : 0;

  const initialLevel = route?.from.levelId ?? map.placesById.get(startId ?? "")?.levelId ?? map.levels[0]?.id ?? "";
  const [levelId, setLevelId] = useState(initialLevel);
  const [shownRoute, setShownRoute] = useState(route);
  if (route !== shownRoute) {
    setShownRoute(route);
    setLevelId(initialLevel);
  }
  const markerLevel = anim.playing ? position?.levelId : undefined;
  const [followedLevel, setFollowedLevel] = useState(markerLevel);
  if (markerLevel !== followedLevel) {
    setFollowedLevel(markerLevel);
    if (markerLevel) setLevelId(markerLevel);
  }

  return {
    map,
    route,
    target,
    startId,
    anim,
    activeStep,
    levelId,
    setLevelId,
    goTo: setTarget,
    mapProps: {
      map,
      levelId,
      onLevelChange: setLevelId,
      route,
      distance: anim.distance,
      position: anim.playing || anim.distance > 0 ? position : null,
      follow: anim.playing,
      startId,
      onDirections: (place: Place) => setTarget({ placeId: place.id }),
    },
  };
}

/** `inset` is what the page covers with its own panels; `walkControls` sit along the bottom of the uncovered area. */
export function RouteMap({
  state,
  view,
  compact,
  inset = NO_INSET,
  walkControls,
}: {
  state: HospitalRoute;
  view: ViewMode;
  compact?: boolean;
  inset?: Inset;
  walkControls?: boolean;
}) {
  const { route, anim, activeStep, map } = state;
  const mapInset = walkControls ? { ...inset, bottom: inset.bottom + WALK_ROW } : inset;
  const props = { ...state.mapProps, compact, inset: mapInset };
  const current = route?.steps[activeStep];
  const next = route?.steps[activeStep + 1];
  const banner = route && current && (anim.playing || anim.distance > 0) && (
    <div
      className={cn(
        "flex w-full max-w-xl items-center gap-2 rounded-2xl bg-slate-900/95 px-5 py-3 text-white shadow-2xl",
        walkControls && "pointer-events-auto max-w-2xl py-2.5 pr-2.5",
      )}
      data-testid="route-banner"
    >
      <StepIcon kind={current.kind} className="size-11 bg-white/15 text-white" />
      <div className="min-w-0 flex-1">
        <div className="text-base leading-snug font-semibold sm:text-lg">{current.text}</div>
        <div className="hidden text-sm text-slate-300 sm:block">
          {next ? `In ${formatDistance(Math.max(0, next.at - anim.distance), map.units)}: ${next.text}` : "You have arrived"}
        </div>
      </div>
      <div className="hidden text-right text-sm text-slate-300 sm:block">
        <div className="text-xl font-bold text-white">{formatDistance(route.totalDistance - anim.distance, map.units)}</div>
        to go
      </div>
      {walkControls && <BannerButtons anim={anim} route={route} />}
    </div>
  );
  return (
    <div className="relative h-full min-h-0 w-full">
      <div
        className={cn(
          "grid h-full min-h-0 w-full",
          view === "split" && "gap-px bg-border landscape:grid-cols-2 portrait:grid-rows-2",
        )}
      >
        {view !== "3d" && <Map2D {...props} />}
        {view !== "2d" && <Map3D {...props} />}
      </div>
      {walkControls
        ? route && (
            <div
              className="pointer-events-none absolute flex justify-center px-4"
              style={{ left: inset.left + FLOOR_CHIPS, right: inset.right, bottom: inset.bottom + 16 }}
            >
              {banner || (
                <button
                  onClick={anim.toggle}
                  data-testid="route-play"
                  className="pointer-events-auto flex h-14 items-center gap-3 rounded-full bg-primary pr-7 pl-5 text-lg font-bold text-primary-foreground shadow-[0_10px_28px_rgba(8,127,120,0.35)]"
                >
                  <Play className="size-5 fill-current" />
                  Show me the way
                </button>
              )}
            </div>
          )
        : banner && <div className="pointer-events-none absolute inset-x-0 bottom-16 flex justify-center px-4">{banner}</div>}
    </div>
  );
}

function BannerButtons({ anim, route }: { anim: RouteAnimation; route: Route }) {
  const finished = anim.distance >= route.totalDistance - 1e-6;
  return (
    <>
      <button
        onClick={anim.toggle}
        data-testid="route-play"
        aria-label={anim.playing ? "Pause" : finished ? "Replay" : "Resume"}
        className="flex size-13 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"
      >
        {anim.playing ? <Pause className="size-5 fill-current" /> : <Play className="size-5 fill-current" />}
      </button>
      <button
        onClick={anim.restart}
        aria-label="Start again"
        className="flex size-13 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white"
      >
        <RotateCcw className="size-5" />
      </button>
    </>
  );
}

const STEP_ICONS: Record<StepKind, LucideIcon> = {
  start: Navigation,
  straight: ArrowUp,
  left: CornerUpLeft,
  right: CornerUpRight,
  "slight-left": ArrowUpLeft,
  "slight-right": ArrowUpRight,
  uturn: Undo2,
  "stairs-up": Footprints,
  "stairs-down": Footprints,
  "elevator-up": ArrowUpDown,
  "elevator-down": ArrowUpDown,
  "escalator-up": TrendingUp,
  "escalator-down": TrendingDown,
  ramp: Accessibility,
  waypoint: MapPin,
  arrive: Flag,
};

function StepIcon({ kind, className }: { kind: StepKind; className?: string }) {
  const Icon = STEP_ICONS[kind];
  return (
    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", className)}>
      <Icon className="size-5" aria-hidden />
    </span>
  );
}

export function routeSummary(map: LoadedMap, route: Route): string {
  const floors = route.levelsVisited.map((id) => map.levelsById.get(id)?.name ?? id).join(" → ");
  return `About ${formatDuration(route.estimatedSeconds)} · ${formatDistance(route.totalDistance, map.units)} · ${floors}`;
}

export function RouteSteps({ state, limit, className }: { state: HospitalRoute; limit?: number; className?: string }) {
  const { route, map, anim, activeStep } = state;
  if (!route) return null;
  const started = anim.playing || anim.distance > 0;
  const steps = limit ? route.steps.slice(0, limit) : route.steps;
  return (
    <ol className={cn("flex flex-col", className)} data-testid="route-steps">
      {steps.map((step, i) => {
        const active = started && i === activeStep;
        const done = started && i < activeStep;
        const levelName = map.levelsById.get(step.levelId)?.shortName ?? step.levelId;
        return (
          <li key={`${i}-${step.text}`}>
            <button
              onClick={() => anim.seek(step.at)}
              className={cn(
                "flex w-full items-start gap-3.5 rounded-2xl px-3 py-2.5 text-left transition-colors",
                active ? "bg-accent ring-1 ring-primary/40" : "hover:bg-accent/60",
                done && "opacity-50",
              )}
            >
              <StepIcon
                kind={step.kind}
                className={cn(
                  step.kind === "arrive" ? "bg-destructive/15 text-destructive" : "bg-primary/12 text-primary",
                  isTransferStep(step.kind) && "bg-primary text-primary-foreground",
                )}
              />
              <span className="min-w-0 flex-1 pt-1.5">
                <span className={cn("block text-lg leading-snug", (active || isTransferStep(step.kind)) && "font-semibold")}>
                  {step.text}
                </span>
                {isTransferStep(step.kind) ? (
                  <span className="text-sm text-muted-foreground">
                    {step.floors ?? 1} floor{(step.floors ?? 1) > 1 ? "s" : ""}
                  </span>
                ) : (
                  step.distance > 0.5 &&
                  step.kind !== "arrive" && (
                    <span className="text-sm text-muted-foreground">
                      Walk {formatDistance(step.distance, map.units)} · {levelName}
                    </span>
                  )
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function ViewToggle({
  value,
  onChange,
  modes = ["2d", "3d", "split"],
  className,
}: {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  modes?: ViewMode[];
  className?: string;
}) {
  const label: Record<ViewMode, string> = { "2d": "2D", "3d": "3D", split: "Both" };
  return (
    <div className={cn("flex rounded-2xl bg-muted p-1", className)} role="group" aria-label="Map view">
      {modes.map((mode) => (
        <button
          key={mode}
          onClick={() => onChange(mode)}
          aria-pressed={value === mode}
          data-testid={`view-${mode}`}
          className={cn(
            "h-11 min-w-16 rounded-xl px-4 text-base font-bold transition-colors",
            value === mode ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label[mode]}
        </button>
      ))}
    </div>
  );
}

export function StepFreeToggle({
  value,
  onChange,
  className,
}: {
  value: boolean;
  onChange: (stepFree: boolean) => void;
  className?: string;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      aria-pressed={value}
      data-testid="step-free"
      className={cn(
        "flex h-13 items-center gap-2.5 rounded-2xl border px-4 text-base font-semibold transition-colors",
        value ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground hover:border-ring",
        className,
      )}
    >
      <Accessibility className="size-5" />
      Step-free route
    </button>
  );
}

export function PlayButton({ anim, route }: { anim: RouteAnimation; route: Route | null }) {
  if (!route) return null;
  const finished = anim.distance >= route.totalDistance - 1e-6;
  return (
    <div className="flex gap-2">
      <button
        onClick={anim.toggle}
        data-testid="route-play"
        className="flex h-13 items-center gap-2.5 rounded-2xl bg-primary px-5 text-base font-semibold text-primary-foreground shadow-sm"
      >
        {anim.playing ? <Pause className="size-5" /> : <Play className="size-5" />}
        {anim.playing ? "Pause" : finished ? "Replay" : anim.distance > 0 ? "Resume" : "Show me the way"}
      </button>
      {anim.distance > 0 && (
        <button
          onClick={anim.restart}
          aria-label="Start again"
          className="flex size-13 items-center justify-center rounded-2xl border bg-card hover:border-ring"
        >
          <RotateCcw className="size-5" />
        </button>
      )}
    </div>
  );
}
