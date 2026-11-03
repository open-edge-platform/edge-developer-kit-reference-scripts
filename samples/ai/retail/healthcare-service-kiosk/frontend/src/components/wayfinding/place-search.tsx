// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, Search, Stethoscope, X } from "lucide-react";
import { placeBadge } from "@/hospital/place-badges";
import { DESTINATIONS, searchPlaces, type PlaceHit, type RouteTarget } from "@/hospital/wayfinding";
import type { LoadedMap } from "@/lib/wayfinding/types";
import { cn } from "@/lib/utils";
import { FACILITY_ICONS, POPULAR } from "./find-your-way";
import { WardChips } from "./ward-chips";

const CLINICS = DESTINATIONS.filter((d) => d.kind === "department" && !POPULAR.some((p) => p.id === d.id));
const FACILITIES = DESTINATIONS.filter((d) => d.kind === "facility");

export function PlaceSearch({
  map,
  onPick,
  className,
}: {
  map: LoadedMap;
  onPick: (target: RouteTarget) => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const hits = searchPlaces(map, query);
  const typed = query.trim();

  const close = () => {
    setOpen(false);
    setQuery("");
    input.current?.blur();
  };
  const pick = (target: RouteTarget) => {
    onPick(target);
    close();
  };

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return (
    <div ref={root} className={cn("relative", className)}>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          if (hits[0]) pick(hits[0].target);
        }}
        className={cn(
          "flex h-13 items-center gap-3 rounded-2xl border bg-card pl-4 shadow-md transition-colors",
          open ? "border-ring pr-1.5" : "pr-4",
        )}
      >
        <Search className="size-5 shrink-0 text-primary" aria-hidden />
        <label htmlFor="route-search" className="sr-only">
          Search another place
        </label>
        <input
          ref={input}
          id="route-search"
          type="search"
          autoComplete="off"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
          placeholder="Search another place, ward or doctor"
          className="h-full min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        {open && (
          <button
            type="button"
            onClick={close}
            aria-label="Close search"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        )}
      </form>

      {open && (
        <div
          data-testid="route-search-results"
          className="absolute top-full left-0 z-30 mt-2 max-h-[min(40rem,62vh)] w-full min-w-0 sm:min-w-[27rem] overflow-y-auto rounded-3xl border bg-card p-3 shadow-2xl"
        >
          {!typed ? (
            <Suggestions onPick={pick} />
          ) : hits.length ? (
            <ul className="flex flex-col">
              {hits.map((hit) => (
                <li key={hit.key}>
                  <button
                    type="button"
                    onClick={() => pick(hit.target)}
                    className="flex min-h-16 w-full items-center gap-3.5 rounded-2xl px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  >
                    <HitIcon hit={hit} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-lg leading-tight font-semibold">{hit.name}</span>
                      <span className="block truncate text-sm text-muted-foreground">{hit.detail}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-4 text-lg text-muted-foreground">
              Nothing matches “{typed}”. Try another word, or ask at the information counter.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function HitIcon({ hit }: { hit: PlaceHit }) {
  const badge = hit.place ? placeBadge(hit.place) : null;
  const facility = "destinationId" in hit.target ? FACILITY_ICONS[hit.target.destinationId] : undefined;
  const Icon = hit.doctor ? Stethoscope : (badge?.icon ?? facility ?? MapPin);
  return (
    <span
      className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-white"
      style={badge && !hit.doctor ? { background: badge.color } : undefined}
    >
      <Icon className="size-5" strokeWidth={2.2} />
    </span>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 px-1 text-sm font-bold tracking-[0.14em] text-muted-foreground uppercase">{children}</p>;
}

const CHIP =
  "inline-flex min-h-12 items-center gap-2 rounded-full border-2 border-input bg-background px-4 text-base font-semibold text-ink transition-colors hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

function Suggestions({ onPick }: { onPick: (target: RouteTarget) => void }) {
  return (
    <div className="flex flex-col gap-4 p-1">
      <div>
        <Heading>Popular destinations</Heading>
        <div className="grid grid-cols-2 gap-1">
          {POPULAR.map(({ id, label, hint, icon: Icon, urgent }) => (
            <button
              key={id}
              type="button"
              onClick={() => onPick({ destinationId: id })}
              className="flex min-h-15 items-center gap-3 rounded-2xl px-2.5 py-2 text-left hover:bg-accent"
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-xl",
                  urgent ? "bg-destructive/10 text-destructive" : "bg-accent text-primary",
                )}
              >
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-base leading-tight font-semibold">{label}</span>
                <span className="block truncate text-sm text-muted-foreground">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <Heading>Clinics</Heading>
        <div className="flex flex-wrap gap-2">
          {CLINICS.map((d) => (
            <button key={d.id} type="button" onClick={() => onPick({ destinationId: d.id })} className={CHIP}>
              {d.name}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Heading>Wards</Heading>
        <WardChips onPick={(id) => onPick({ destinationId: id })} stacked />
      </div>
      <div>
        <Heading>Facilities</Heading>
        <div className="flex flex-wrap gap-2">
          {FACILITIES.map((f) => {
            const Icon = FACILITY_ICONS[f.id] ?? MapPin;
            return (
              <button key={f.id} type="button" onClick={() => onPick({ destinationId: f.id })} className={CHIP}>
                <Icon className="size-5 text-primary" aria-hidden />
                {f.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
