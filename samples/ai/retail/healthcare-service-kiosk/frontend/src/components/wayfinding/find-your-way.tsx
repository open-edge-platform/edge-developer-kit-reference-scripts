// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import {
  Accessibility,
  Baby,
  Banknote,
  FlaskConical,
  List,
  MapPin,
  Moon,
  Pill,
  ScanLine,
  Search,
  Siren,
  Toilet,
  Utensils,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { CtaButton } from "@/components/kiosk/cta-button";
import { Notice } from "@/components/kiosk/notice";
import { TapCard } from "@/components/kiosk/tap-card";
import { DEPARTMENTS, department } from "@/hospital/data";
import { asksForAnyWard, DESTINATIONS, findDestination, kioskPlace } from "@/hospital/wayfinding";
import type { LoadedMap } from "@/lib/wayfinding/types";
import { cn } from "@/lib/utils";
import { Map2D } from "./map-2d";
import { useHospitalMap } from "./route-view";
import { WardChips } from "./ward-chips";

export const FACILITY_ICONS: Record<string, LucideIcon> = {
  restroom: Toilet,
  surau: Moon,
  atm: Banknote,
  "baby-room": Baby,
  cafeteria: Utensils,
};

export const POPULAR: { id: string; label: string; hint: string; icon: LucideIcon; urgent?: boolean }[] = [
  { id: "pharmacy", label: "Pharmacy", hint: "Medicines", icon: Pill },
  { id: "radiology", label: "Radiology", hint: "X-ray & scans", icon: ScanLine },
  { id: "laboratory", label: "Laboratory", hint: "Blood tests", icon: FlaskConical },
  { id: "billing", label: "Billing counter", hint: "Payments", icon: Wallet },
  { id: "emergency", label: "Emergency", hint: "24 hours", icon: Siren, urgent: true },
];

const FACILITIES = DESTINATIONS.filter((d) => d.kind === "facility");

function SubHeading({ children }: { children: React.ReactNode }) {
  return <p className="mb-2.5 text-sm font-bold tracking-[0.14em] text-muted-foreground uppercase">{children}</p>;
}

export function FindYourWay({
  onRoute,
  onBrowse,
}: {
  onRoute: (destinationId: string) => void;
  /** Opens the list of every destination, at its wards with "wards". */
  onBrowse: (section?: "wards") => void;
}) {
  const { map, missing } = useHospitalMap();
  const [query, setQuery] = useState("");
  const [notFound, setNotFound] = useState("");
  const here = map ? map.placesById.get(kioskPlace(map) ?? "") : undefined;
  const hereLevel = here && map ? map.levelsById.get(here.levelId) : undefined;

  const search = (event: React.FormEvent) => {
    event.preventDefault();
    const phrase = query.trim();
    if (!phrase) return;
    const match = findDestination(map, phrase);
    if (match) onRoute(match.id);
    else if (asksForAnyWard(phrase)) onBrowse("wards");
    else setNotFound(phrase);
  };

  return (
    <section
      aria-labelledby="find-your-way"
      className={cn(
        "ks-rest grid overflow-hidden rounded-[1.75rem] border border-primary/25 bg-card",
        !missing && "lg:landscape:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]",
      )}
    >
      <div className="flex flex-col gap-5 p-6 sm:p-7">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold tracking-[0.18em] text-primary uppercase">
            <MapPin className="size-4" aria-hidden />
            Find your way
          </p>
          <h2 id="find-your-way" className="mt-2 font-heading text-3xl font-semibold tracking-tight">
            Where do you need to go?
          </h2>
        </div>

        <form role="search" onSubmit={search} className="flex gap-3">
          <label
            htmlFor="destination-search"
            className="flex h-16 min-w-0 flex-1 items-center gap-3 rounded-2xl border-[1.5px] bg-field px-5 transition-colors focus-within:border-ring"
          >
            <Search className="size-6 shrink-0 text-primary" aria-hidden />
            <span className="sr-only">Search for a clinic, ward, doctor or facility</span>
            <input
              id="destination-search"
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setNotFound("");
              }}
              placeholder="Search a clinic, ward or doctor, e.g. x-ray, Ward 5A"
              className="h-full min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-muted-foreground"
            />
          </label>
          <CtaButton type="submit" className="min-h-16 px-8 sm:px-8">
            Go
          </CtaButton>
        </form>
        {notFound && (
          <Notice tone="warning" className="text-lg">
            Nothing matches “{notFound}”. Try another word, or tap All clinics A–Z.
          </Notice>
        )}

        <div>
          <SubHeading>Popular destinations</SubHeading>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:landscape:grid-cols-3">
            {POPULAR.map(({ id, label, hint, icon: Icon, urgent }) => {
              const d = department(id);
              return (
                <TapCard
                  key={id}
                  onClick={() => onRoute(id)}
                  className={cn(
                    "flex min-h-20 items-center gap-3.5 rounded-2xl px-4 py-3",
                    urgent && "border-destructive/30 bg-destructive/5",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-12 shrink-0 items-center justify-center rounded-xl",
                      urgent ? "bg-destructive/10 text-destructive" : "bg-accent text-primary",
                    )}
                  >
                    <Icon className="size-6" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-lg leading-tight font-semibold">{label}</span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">
                      {hint}
                      {d && ` · ${d.building}, ${d.floor}`}
                    </span>
                  </span>
                </TapCard>
              );
            })}
            <TapCard
              onClick={() => onBrowse()}
              className="flex min-h-20 items-center gap-3.5 rounded-2xl border-2 border-dashed px-4 py-3"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                <List className="size-6" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-lg leading-tight font-semibold">All clinics A–Z</span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{DEPARTMENTS.length} departments</span>
              </span>
            </TapCard>
          </div>
        </div>

        <div>
          <SubHeading>Nearby facilities</SubHeading>
          <div className="flex flex-wrap gap-2.5">
            {FACILITIES.map((f) => {
              const Icon = FACILITY_ICONS[f.id] ?? MapPin;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => onRoute(f.id)}
                  className="inline-flex min-h-13 cursor-pointer items-center gap-2 rounded-full border-2 border-input bg-background px-4 text-base font-semibold text-ink transition-colors hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <Icon className="size-5 text-primary" aria-hidden />
                  {f.name}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <SubHeading>Visiting a patient</SubHeading>
          <WardChips onPick={onRoute} onMore={() => onBrowse("wards")} />
        </div>
      </div>

      {!missing && (
        <div className="flex min-h-80 flex-col gap-3 border-t bg-accent/40 p-4 lg:landscape:border-t-0 lg:landscape:border-l">
          {here && (
            <span className="inline-flex items-center gap-2.5 self-start rounded-full bg-card px-4 py-2 text-base font-semibold text-accent-foreground">
              <span className="size-2.5 rounded-full bg-primary ring-4 ring-primary/20" aria-hidden />
              You are here · {here.name}
              {hereLevel && `, ${hereLevel.name}`}
            </span>
          )}
          <div className="relative min-h-72 flex-1 overflow-hidden rounded-2xl border bg-card">
            <div className="absolute inset-0">
              {map ? <MapPreview map={map} /> : <div className="h-full animate-pulse bg-muted" />}
            </div>
          </div>
          <p className="flex items-center gap-2 px-1 text-base text-ink">
            <Accessibility className="size-5 shrink-0 text-primary" aria-hidden />
            Every route can avoid stairs and escalators.
          </p>
        </div>
      )}
    </section>
  );
}

function MapPreview({ map }: { map: LoadedMap }) {
  const startId = kioskPlace(map);
  const [levelId, setLevelId] = useState(
    () => map.placesById.get(startId ?? "")?.levelId ?? map.levels[0]?.id ?? "",
  );
  return (
    <Map2D
      map={map}
      levelId={levelId}
      onLevelChange={setLevelId}
      route={null}
      distance={0}
      position={null}
      follow={false}
      startId={startId}
      compact
    />
  );
}
