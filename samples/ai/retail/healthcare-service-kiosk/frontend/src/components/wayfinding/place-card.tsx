// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { Navigation, X } from "lucide-react";
import type { Level, Place } from "@/lib/wayfinding/types";

export function PlaceCard({
  place,
  level,
  onDirections,
  onClose,
}: {
  place: Place;
  level?: Level;
  onDirections?: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="relative w-64 rounded-2xl border bg-card p-4 text-card-foreground shadow-xl"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute top-2 right-2 flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
      >
        <X className="size-5" />
      </button>
      <div className="flex items-center gap-3 pr-8">
        <span className="text-2xl">{place.icon}</span>
        <div className="min-w-0">
          <div className="truncate text-base font-bold">{place.name}</div>
          <div className="text-sm text-muted-foreground">{level?.name ?? place.levelId}</div>
        </div>
      </div>
      {onDirections && (
        <button
          onClick={onDirections}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground"
        >
          <Navigation className="size-5" />
          Directions here
        </button>
      )}
    </div>
  );
}
