// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { Check, ChevronDown, Clock, List, MapPin, Printer, Settings2, Smartphone } from "lucide-react";
import { CtaButton } from "@/components/kiosk/cta-button";
import { PhoneQr } from "@/components/kiosk/phone-qr";
import { printingEnabled } from "@/components/kiosk/print-button";
import { SecondaryButton } from "@/components/kiosk/secondary-button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PlaceSearch } from "@/components/wayfinding/place-search";
import {
  RouteMap,
  RouteSteps,
  StepFreeToggle,
  useHospitalMap,
  useHospitalRoute,
  ViewToggle,
  type HospitalRoute,
  type ViewMode,
} from "@/components/wayfinding/route-view";
import { Spinner } from "@/components/ui/spinner";
import { useAutoRestart, useIdleRestart } from "@/hooks/use-auto-restart";
import type { KioskFlowState } from "@/hooks/use-kiosk-flow";
import { placeBadge } from "@/hospital/place-badges";
import { destination as findById, targetName, wardNote } from "@/hospital/wayfinding";
import { formatDistance, formatDuration } from "@/lib/wayfinding/geometry";
import type { LoadedMap } from "@/lib/wayfinding/types";
import { resultData } from "@/services/shared/result";
import SharedResultStep from "@/services/shared/steps/result";
import type { StepProps } from "@/services/shared/step-props";
import { directionsResult } from "../directions";

export default function DirectionsResultStep(props: StepProps) {
  const { map, missing } = useHospitalMap();
  if (missing) return <SharedResultStep {...props} state={withWrittenDirections(props.state)} />;
  if (!map) {
    return (
      <div className="flex items-center gap-3 text-lg text-muted-foreground">
        <Spinner className="size-6" />
        Loading the map…
      </div>
    );
  }
  return <RouteScreen {...props} map={map} />;
}

/** A visit opened from a destination tile skipped the step that writes these out. */
function withWrittenDirections(state: KioskFlowState): KioskFlowState {
  const picked = findById(state.data.destination ?? "");
  if (state.data.resultRows || !picked) return state;
  return { ...state, data: { ...state.data, ...resultData(directionsResult(picked)) } };
}

function RouteScreen({ state, actions, map }: StepProps & { map: LoadedMap }) {
  const [stepFree, setStepFree] = useState(state.data.stepFree === "yes");
  const [view, setView] = useState<ViewMode>("3d");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState(false);
  const routeState = useHospitalRoute(map, state.data.destination ?? "", stepFree);
  const restart = useAutoRestart({ when: true, paused: routeState.anim.playing, onRestart: actions.reset });
  useIdleRestart({ enabled: restart.held, paused: routeState.anim.playing, onIdle: actions.reset });
  const name = routeState.route?.to.name ?? targetName(map, routeState.target) ?? "your destination";
  const steps = routeState.route?.steps.length ?? 0;

  return (
    <div className="hc-route-screen flex w-full max-w-[100rem] flex-1 flex-col gap-4 animate-ks-fade" onPointerDownCapture={() => { if (!restart.held) restart.hold(); }}>
      <div className="hc-route-heading flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <DestinationTile routeState={routeState} />
          <Title map={map} routeState={routeState} name={name} />
        </div>
        <Summary map={map} routeState={routeState} />
      </div>
      <div className={`hc-route-stage grid min-h-0 flex-1 gap-4 ${open ? "xl:landscape:grid-cols-[minmax(0,1fr)_22rem]" : ""}`}>
        <section aria-label="Route map" className="hc-route-map relative min-h-[28rem] overflow-hidden rounded-3xl border bg-muted">
          <div className="absolute inset-0"><RouteMap state={routeState} view={view} walkControls /></div>
        </section>
        {open && (
          <section id="directions-steps" aria-label="Step-by-step directions" className="hc-route-steps max-h-80 overflow-y-auto rounded-2xl border bg-card p-4 xl:landscape:max-h-[60vh]">
            <h2 className="mb-3 px-3 text-lg font-semibold">Step-by-step directions</h2>
            <RouteSteps state={routeState} />
          </section>
        )}
      </div>
      <div className="hc-route-toolbar flex flex-wrap items-center gap-3">
        <PlaceSearch map={map} onPick={routeState.goTo} className="min-w-0 basis-64 flex-1 sm:max-w-lg" />
        <button onClick={() => setOptions(true)} className="flex min-h-13 items-center gap-2 rounded-2xl border bg-card px-4 text-base font-semibold">
          <Settings2 className="size-5" aria-hidden /> Map options{stepFree && " · Step-free"}
        </button>
        <button onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="directions-steps" className="flex min-h-13 items-center gap-2 rounded-2xl border bg-card px-4 text-base font-semibold">
          <List className="size-5" aria-hidden /> {open ? "Hide steps" : `All ${steps} steps`} <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
      </div>
      <Actions finishLabel={`Finish${restart.secondsLeft !== null ? ` (${restart.secondsLeft})` : ""}`} onFinish={actions.reset} onHold={restart.secondsLeft !== null ? restart.hold : undefined} phoneText={phoneText(name, routeState)} />
      {routeState.route && (
        <div data-print className="hidden print:block">
          <h1>Directions to {name}</h1>
          <p>About {formatDuration(routeState.route.estimatedSeconds)} · {formatDistance(routeState.route.totalDistance, map.units)}</p>
          <ol>{routeState.route.steps.map((step, i) => <li key={i}>{step.text}</li>)}</ol>
        </div>
      )}
      <Dialog open={options} onOpenChange={setOptions}>
        <DialogContent className="rounded-3xl p-6 sm:max-w-md">
          <DialogTitle className="text-2xl">Map options</DialogTitle>
          <DialogDescription>Choose your view and preferred route.</DialogDescription>
          <div className="my-3 flex flex-col items-start gap-5">
            <div><p className="mb-2 font-semibold">Map view</p><ViewToggle value={view} onChange={setView} modes={["3d", "2d"]} /></div>
            <div><StepFreeToggle value={stepFree} onChange={setStepFree} /><p className="mt-2 text-sm text-muted-foreground">Uses lifts and avoids stairs and escalators.</p></div>
          </div>
          <CtaButton onClick={() => setOptions(false)}>Done</CtaButton>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DestinationTile({ routeState }: { routeState: HospitalRoute }) {
  const badge = routeState.route ? placeBadge(routeState.route.to) : null;
  const Icon = badge?.icon ?? MapPin;
  return (
    <span
      className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-white"
      style={badge ? { background: badge.color } : undefined}
    >
      <Icon className="size-7" strokeWidth={2.2} />
    </span>
  );
}

function Title({ map, routeState, name }: { map: LoadedMap; routeState: HospitalRoute; name: string }) {
  const level = routeState.route ? map.levelsById.get(routeState.route.to.levelId) : undefined;
  const note = routeState.route ? wardNote(routeState.route.to) : undefined;
  return (
    <div className="min-w-0 flex-1">
      <h1 className="font-heading leading-tight">
        <span className="block text-base font-medium text-muted-foreground">Directions to</span>{" "}
        <span className="block text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{name}</span>
      </h1>
      {level && (
        <p className="mt-0.5 text-base text-muted-foreground">
          {level.name}
          {level.subtitle && ` · ${level.subtitle}`}
        </p>
      )}
      {note && (
        <p className="mt-1 text-base font-semibold text-accent-foreground" data-testid="ward-note">
          {note}
        </p>
      )}
    </div>
  );
}

function Summary({ map, routeState }: { map: LoadedMap; routeState: HospitalRoute }) {
  const { route } = routeState;
  if (!route) {
    return (
      <p className="text-base text-muted-foreground" data-testid="route-summary">
        No route found — please ask at the information counter.
      </p>
    );
  }
  const floors = route.levelsVisited.map((id) => map.levelsById.get(id)?.name ?? id).join(" → ");
  return (
    <div className="flex flex-wrap gap-2 text-base" data-testid="route-summary">
      <span className="rounded-full bg-accent px-3 py-1 text-accent-foreground">About {formatDuration(route.estimatedSeconds)}</span>
      <span className="rounded-full bg-accent px-3 py-1 text-accent-foreground">{formatDistance(route.totalDistance, map.units)}</span>
      <span className="rounded-full bg-muted px-3 py-1">{floors}</span>
    </div>
  );
}

/** The written route, for the phone: plain text works offline and carries nothing about the visitor. */
function phoneText(name: string, routeState: HospitalRoute): string | null {
  const route = routeState.route;
  if (!route) return null;
  const steps = route.steps.map((step, i) => `${i + 1}. ${step.text}`);
  return [`Directions to ${name} (about ${formatDuration(route.estimatedSeconds)})`, ...steps].join("\n").slice(0, 1_100);
}

function Actions({
  finishLabel,
  onFinish,
  onHold,
  phoneText,
}: {
  finishLabel: string;
  onFinish: () => void;
  onHold?: () => void;
  phoneText?: string | null;
}) {
  const [phone, setPhone] = useState(false);
  return (
    <div className="hc-route-actions flex flex-wrap items-center justify-end gap-3">
      <div className="hc-route-timeout mr-auto flex min-h-12 items-center text-base text-muted-foreground">
        {onHold ? (
          <button onClick={onHold} className="flex min-h-12 items-center gap-2 rounded-xl px-3 hover:text-foreground">
            <Clock className="size-5 shrink-0" aria-hidden /> I need more time
          </button>
        ) : (
          <p role="status" className="px-3">Auto-finish paused</p>
        )}
      </div>
      <div className="hc-route-action-buttons flex flex-wrap gap-3">
        {printingEnabled() && (
          <SecondaryButton onClick={() => window.print()} aria-label="Print">
            <Printer /> Print
          </SecondaryButton>
        )}
        {phoneText && (
          <SecondaryButton onClick={() => setPhone(true)} data-testid="route-phone">
            <Smartphone />
            Phone
          </SecondaryButton>
        )}
        <CtaButton className="h-14 min-h-14 flex-1 px-6 py-0 text-lg sm:px-6" onClick={onFinish}>
          <Check className="size-5" />
          {finishLabel}
        </CtaButton>
      </div>
      {phoneText && (
        <Dialog open={phone} onOpenChange={setPhone}>
          <DialogContent className="flex max-w-xl flex-col gap-5 rounded-[30px] p-8 sm:max-w-xl">
            <DialogTitle className="font-heading text-3xl font-semibold tracking-tight">Take the directions with you</DialogTitle>
            <DialogDescription className="text-lg text-muted-foreground">
              Point your phone camera at the code. The steps open as text — no app, no internet needed.
            </DialogDescription>
            <PhoneQr text={phoneText} title="Every step, on your phone" hint="Keep it open as you walk; signs on each floor match the steps." />
            <CtaButton onClick={() => setPhone(false)}>Done</CtaButton>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
