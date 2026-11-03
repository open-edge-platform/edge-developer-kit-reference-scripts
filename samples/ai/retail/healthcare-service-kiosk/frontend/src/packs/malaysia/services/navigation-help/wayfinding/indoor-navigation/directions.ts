// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { department, ward } from "@/hospital/data";
import type { Destination } from "@/hospital/wayfinding";
import { formatDistance, formatDuration } from "@/lib/wayfinding/geometry";
import { isTransferStep, type Route } from "@/lib/wayfinding/routing";
import type { LoadedMap } from "@/lib/wayfinding/types";
import type { ServiceResult } from "@/services/shared/result";

export type Routed = { map: LoadedMap; route: Route };

function where(d: Destination, routed?: Routed | null): string {
  const dept = department(d.id);
  const w = ward(d.id);
  const site = dept ?? w;
  const floor = routed ? routed.map.levelsById.get(routed.route.to.levelId)?.name : site?.floor;
  const parts = [site ? `${site.building}, ${floor}` : d.kind === "place" ? d.hint : floor, dept?.hours ?? w?.visiting];
  if (routed) {
    parts.push(
      `about ${formatDuration(routed.route.estimatedSeconds)} (${formatDistance(routed.route.totalDistance, routed.map.units)}) from here`,
    );
  }
  return parts.filter(Boolean).join(" · ");
}

/** Every step of the route when there is a map, else the destination's written directions. */
export function directionsResult(d: Destination, routed?: Routed | null): ServiceResult {
  const lines = routed ? routed.route.steps.map((s) => s.text) : d.directions;
  return {
    title: `Directions to ${routed?.route.to.name ?? d.name}`,
    intro: where(d, routed) || undefined,
    rows: lines.map((line, i) => ({ label: `Step ${i + 1}`, value: line })),
  };
}

export function directionsMessage(d: Destination, routed?: Routed | null): string {
  const heading = `${routed?.route.to.name ?? d.name} — ${where(d, routed)}.`;
  if (!routed) return [heading, ...d.directions].join("\n");
  const steps = routed.route.steps;
  const key = steps.filter((s, i) => i === 0 || i === steps.length - 1 || isTransferStep(s.kind));
  return [heading, ...key.map((s, i) => `${i + 1}. ${s.text}`), "The map below shows every turn."].join("\n");
}
