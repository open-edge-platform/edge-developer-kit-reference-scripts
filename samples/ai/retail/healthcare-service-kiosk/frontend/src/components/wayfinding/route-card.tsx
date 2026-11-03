// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import { ChevronDown, List, MapPin, Maximize2, Minimize2, Smartphone } from "lucide-react";
import type { FlowRoute } from "@/app/api/_lib/flows/types";
import { PhoneQr } from "@/components/kiosk/phone-qr";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { placeBadge } from "@/hospital/place-badges";
import { formatDuration } from "@/lib/wayfinding/geometry";
import type { Route } from "@/lib/wayfinding/routing";
import type { LoadedMap } from "@/lib/wayfinding/types";
import { cn } from "@/lib/utils";
import {
  PlayButton,
  RouteMap,
  RouteSteps,
  routeSummary,
  StepFreeToggle,
  useHospitalMap,
  useHospitalRoute,
  ViewToggle,
  type HospitalRoute,
  type ViewMode,
} from "./route-view";

const PREVIEW_STEPS = 3;

export function RouteCard({ route }: { route: FlowRoute }) {
  const { map } = useHospitalMap();
  if (!map) return null;
  return <Card map={map} destination={route.destination} initialStepFree={route.stepFree ?? false} />;
}

/** `data-route-card` marks the map as being read — see ChatKiosk, which holds its wipe on a tap here. */
function Card({ map, destination, initialStepFree }: { map: LoadedMap; destination: string; initialStepFree: boolean }) {
  const [stepFree, setStepFree] = useState(initialStepFree);
  const [view, setView] = useState<ViewMode>("3d");
  const [expanded, setExpanded] = useState(false);
  const [phone, setPhone] = useState(false);
  const [full, setFull] = useState(false);
  // The walk-through plays on a loop while the card is in view, so nobody has to find the button;
  // one scrolled away with the conversation stops re-rendering its map every frame.
  const [card, setCard] = useState<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!card) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    observer.observe(card);
    return () => observer.disconnect();
  }, [card]);
  const state = useHospitalRoute(map, destination, stepFree, inView);
  const { route, anim } = state;
  if (!route) return null;
  const more = route.steps.length - PREVIEW_STEPS;

  return (
    <div ref={setCard} className="w-full overflow-hidden rounded-3xl border bg-card" data-testid="route-card" data-route-card>
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <DestinationTile route={route} className="size-12" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg leading-snug font-semibold">Directions to {route.to.name}</p>
          <p className="text-sm text-muted-foreground">{routeSummary(map, route)}</p>
        </div>
        <button
          onClick={() => setFull(true)}
          data-testid="route-card-full"
          className="flex h-13 shrink-0 items-center gap-2 rounded-2xl border bg-card px-4 text-base font-semibold text-primary transition-colors hover:border-ring"
        >
          <Maximize2 className="size-5" aria-hidden />
          Full screen
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5">
        <ViewToggle value={view} onChange={setView} modes={["3d", "2d"]} />
        <div className="flex flex-wrap gap-2">
          <StepFreeToggle value={stepFree} onChange={setStepFree} />
          <PlayButton anim={anim} route={route} />
        </div>
      </div>
      {/* One live map at a time: the full-screen view takes over the walk-through while it is open. */}
      <div className="h-[clamp(20rem,46vh,34rem)] bg-muted">
        {!full && <RouteMap state={state} view={view} compact />}
      </div>
      <div className="flex flex-col gap-1 border-t px-3 py-3">
        <RouteSteps state={state} limit={expanded ? undefined : PREVIEW_STEPS} />
        <div className="flex flex-wrap gap-1">
          {more > 0 && (
            <button
              onClick={() => setExpanded((open) => !open)}
              className="flex items-center gap-1.5 self-start rounded-xl px-3 py-2 text-base font-semibold text-primary hover:bg-accent"
            >
              <ChevronDown className={expanded ? "size-5 rotate-180" : "size-5"} />
              {expanded ? "Fewer steps" : `All ${route.steps.length} steps`}
            </button>
          )}
          <button
            onClick={() => setPhone((open) => !open)}
            aria-pressed={phone}
            className="flex items-center gap-1.5 self-start rounded-xl px-3 py-2 text-base font-semibold text-primary hover:bg-accent"
            data-testid="route-card-phone"
          >
            <Smartphone className="size-5" />
            {phone ? "Hide the code" : "On my phone"}
          </button>
        </div>
        {phone && <RoutePhoneQr route={route} className="mx-3 mt-1" />}
      </div>
      <FullScreenRoute
        open={full}
        onOpenChange={setFull}
        state={state}
        view={view}
        onView={setView}
        stepFree={stepFree}
        onStepFree={setStepFree}
      />
    </div>
  );
}

function FullScreenRoute({
  open,
  onOpenChange,
  state,
  view,
  onView,
  stepFree,
  onStepFree,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: HospitalRoute;
  view: ViewMode;
  onView: (mode: ViewMode) => void;
  stepFree: boolean;
  onStepFree: (stepFree: boolean) => void;
}) {
  const [phone, setPhone] = useState(false);
  const { map, route } = state;
  if (!route) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        data-route-card
        data-testid="route-full"
        className="top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-4 rounded-none bg-background p-4 text-base ring-0 sm:max-w-none sm:p-6"
      >
        <div className="flex flex-wrap items-center gap-4">
          <DestinationTile route={route} className="size-14" />
          <div className="min-w-0 flex-1">
            <DialogTitle className="font-heading text-2xl leading-tight font-semibold tracking-tight text-balance sm:text-3xl">
              Directions to {route.to.name}
            </DialogTitle>
            <DialogDescription className="mt-1 text-base">{routeSummary(map, route)}</DialogDescription>
          </div>
          <ViewToggle value={view} onChange={onView} modes={["3d", "2d"]} />
          <StepFreeToggle value={stepFree} onChange={onStepFree} />
          <DialogClose asChild>
            <button
              data-testid="route-full-close"
              className="flex h-14 shrink-0 items-center gap-2.5 rounded-2xl bg-primary px-6 text-lg font-semibold text-primary-foreground shadow-sm"
            >
              <Minimize2 className="size-5" aria-hidden />
              Back to chat
            </button>
          </DialogClose>
        </div>
        <div className="grid min-h-0 flex-1 gap-4 landscape:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] portrait:grid-rows-[minmax(0,1fr)_minmax(0,18rem)]">
          <section aria-label="Route map" className="relative min-h-0 overflow-hidden rounded-3xl border bg-muted">
            <div className="absolute inset-0">
              <RouteMap state={state} view={view} walkControls />
            </div>
          </section>
          <section
            aria-label={phone ? "Directions on your phone" : "Step-by-step directions"}
            className="flex min-h-0 flex-col overflow-hidden rounded-3xl border bg-card"
          >
            <div className="flex items-center justify-between gap-2 border-b py-2 pr-2 pl-5">
              <h2 className="text-lg font-semibold">{phone ? "On your phone" : "Step by step"}</h2>
              <button
                onClick={() => setPhone((shown) => !shown)}
                aria-pressed={phone}
                className="flex min-h-12 items-center gap-2 rounded-xl px-3 text-base font-semibold text-primary hover:bg-accent"
                data-testid="route-full-phone"
              >
                {phone ? <List className="size-5" aria-hidden /> : <Smartphone className="size-5" aria-hidden />}
                {phone ? "Show the steps" : "On my phone"}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {phone ? <RoutePhoneQr route={route} className="m-2 border-0 p-2" /> : <RouteSteps state={state} />}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DestinationTile({ route, className }: { route: Route; className?: string }) {
  const badge = placeBadge(route.to);
  const Icon = badge?.icon ?? MapPin;
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center rounded-2xl bg-primary text-white", className)}
      style={badge ? { background: badge.color } : undefined}
      aria-hidden
    >
      <Icon className="size-1/2" strokeWidth={2.2} />
    </span>
  );
}

function RoutePhoneQr({ route, className }: { route: Route; className?: string }) {
  return (
    <PhoneQr
      className={className}
      title="Every step, on your phone"
      hint="Point your phone camera here — the steps open as text, no app or internet needed."
      text={[
        `Directions to ${route.to.name} (about ${formatDuration(route.estimatedSeconds)})`,
        ...route.steps.map((step, i) => `${i + 1}. ${step.text}`),
      ]
        .join("\n")
        .slice(0, 1_100)}
    />
  );
}
