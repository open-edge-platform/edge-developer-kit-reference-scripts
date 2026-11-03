// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { publicEnv } from "@/lib/public-config";
import { DEFAULT_CATEGORIES } from "@/lib/wayfinding/categories";
import { findRoute, SEARCH_METHODS, type Route, type RouteOptions } from "@/lib/wayfinding/routing";
import type { EdgeVia, LoadedMap, Place } from "@/lib/wayfinding/types";
import { DEPARTMENTS, DOCTORS, WARDS, department, ward, type Ward } from "./data";

/** The hospital's floor plan: public/maps/<name>.json (see healthcare-service-kiosk/README.md, "Indoor navigation"). */
export const HOSPITAL_MAP = "hospital";

export const STEP_FREE_AVOID: EdgeVia[] = ["stairs", "escalator"];

type Facility = {
  id: string;
  name: string;
  keywords: string[];
  directions: string[];
  matches: (place: Place) => boolean;
};

const FACILITIES: Facility[] = [
  {
    id: "restroom",
    name: "Restrooms",
    keywords: ["toilet", "restroom", "washroom", "bathroom", "tandas", "loo"],
    directions: ["Restrooms are on every floor — follow the signs."],
    matches: (p) => p.category === "restroom" || p.name.endsWith("Restroom"),
  },
  {
    id: "surau",
    name: "Surau",
    keywords: ["surau", "prayer", "pray", "musolla", "solat"],
    directions: ["The surau is on Level 2 in Block A, beside the lifts, and on Level 6 in Block C."],
    matches: (p) => p.name === "Surau",
  },
  {
    id: "atm",
    name: "ATM",
    keywords: ["atm", "cash", "withdraw", "bank"],
    directions: ["ATMs are in the main lobby on Level 2 and outside the cafeteria on Level 1."],
    matches: (p) => p.name.startsWith("ATM"),
  },
  {
    id: "baby-room",
    name: "Baby room",
    keywords: ["baby", "nursing", "breastfeed", "diaper", "nappy"],
    directions: ["Baby rooms are on Level 2 beside the lifts, and in Block C on Levels 3 and 6."],
    matches: (p) => p.name.startsWith("Baby Room"),
  },
  {
    id: "cafeteria",
    name: "Cafeteria",
    keywords: ["food", "eat", "cafeteria", "canteen", "cafe", "lunch", "food court"],
    directions: ["The cafeteria is on Level 1 in Block A, one floor down from the main lobby."],
    matches: (p) => p.id === "a-l1-cafeteria",
  },
];

export type Destination = {
  id: string;
  name: string;
  /** "place" is any other room on the map; its id is the room's. */
  kind: "department" | "facility" | "ward" | "place";
  hint: string;
  keywords: string[];
  directions: string[];
  code?: string;
};

export const wardDetail = (w: Ward) => `${w.group === "intensive" ? w.code : w.care} · ${w.building}, ${w.floor}`;

export const DESTINATIONS: Destination[] = [
  ...DEPARTMENTS.map((d) => ({
    id: d.id,
    name: d.name,
    kind: "department" as const,
    hint: `${d.building} · ${d.floor}`,
    keywords: [d.id, d.name.toLowerCase(), d.services.toLowerCase()],
    directions: d.directions,
  })),
  ...FACILITIES.map((f) => ({
    id: f.id,
    name: f.name,
    kind: "facility" as const,
    hint: "Nearest to you",
    keywords: f.keywords,
    directions: f.directions,
  })),
  ...WARDS.map((w) => ({
    id: w.id,
    name: w.name,
    kind: "ward" as const,
    hint: wardDetail(w),
    keywords: w.keywords,
    directions: w.directions,
    code: w.code,
  })),
];

export function destination(id: string): Destination | undefined {
  return DESTINATIONS.find((d) => d.id === id);
}

/** "ward" or "the wards": a visitor who has not said which one. */
export const asksForAnyWard = (query: string) => /^(?:the |a |all |any )?wards?$/.test(normalize(query));

/** A destination by id, or by a spoken/typed phrase ("x-ray", "where is the toilet", "Dr. Lim", "ICU", "ward 5A"). */
export function matchDestination(query: string): Destination | undefined {
  const q = query.trim().toLowerCase();
  if (!q || asksForAnyWard(q)) return undefined;
  const words = wordsOf(q);
  return (
    DESTINATIONS.find((d) => d.id === q) ??
    DESTINATIONS.find((d) => d.name.toLowerCase().includes(q) || q.includes(d.name.toLowerCase())) ??
    DESTINATIONS.find((d) => d.code && words.includes(d.code.toLowerCase())) ??
    doctorsClinic(q) ??
    DESTINATIONS.find((d) => d.keywords.some((k) => k.includes(q) || q.includes(k)))
  );
}

function doctorsClinic(q: string): Destination | undefined {
  const words = new Set(q.split(/[^a-z]+/).filter((w) => w.length >= 3));
  const doctor = DOCTORS.find((d) =>
    d.name.toLowerCase().replace(/^dr\.\s*/, "").split(" ").some((part) => words.has(part)),
  );
  return doctor ? destination(doctor.department) : undefined;
}

export function asHospital(map: LoadedMap): LoadedMap {
  const health = DEFAULT_CATEGORIES.health;
  for (const d of DEPARTMENTS) {
    const place = map.placesById.get(d.place);
    if (place) Object.assign(place, { name: d.name, category: "health", color: health.color, icon: "🏥" });
  }
  return map;
}

/** How routes are searched: `wayfinding.search` in config.yaml (default A*), lifts and ramps only when step-free. */
export function routeOptions(stepFree: boolean): RouteOptions {
  const configured = publicEnv("NEXT_PUBLIC_KIOSK_WAYFINDING_SEARCH");
  const method = SEARCH_METHODS.find((m) => m === configured) ?? "astar";
  return stepFree ? { method, avoid: STEP_FREE_AVOID } : { method };
}

/** Where this kiosk stands: `wayfinding.start` in config.yaml, else the map's default start. */
export function kioskPlace(map: LoadedMap): string | undefined {
  const configured = publicEnv("NEXT_PUBLIC_KIOSK_WAYFINDING_START");
  return configured && map.placesById.has(configured) ? configured : map.defaultStart;
}

function destinationPlaces(map: LoadedMap, id: string): Place[] {
  const facility = FACILITIES.find((f) => f.id === id);
  if (facility) return map.places.filter(facility.matches);
  const place = map.placesById.get(department(id)?.place ?? ward(id)?.place ?? id);
  return place ? [place] : [];
}

/** Seconds a floor change costs when picking the nearest facility: one on this floor wins. */
const FLOOR_CHANGE_SECONDS = 120;

const effort = (route: Route) => route.estimatedSeconds + FLOOR_CHANGE_SECONDS * (route.levelsVisited.length - 1);

/** The quickest route from this kiosk to a destination — the nearest one, for a facility. */
export function routeTo(map: LoadedMap, destinationId: string, stepFree: boolean): Route | null {
  const from = kioskPlace(map);
  if (!from) return null;
  let best: Route | null = null;
  const opts = routeOptions(stepFree);
  for (const place of destinationPlaces(map, destinationId)) {
    const route = findRoute(map, from, place.id, opts);
    if (route && (!best || effort(route) < effort(best))) best = route;
  }
  return best;
}

/** Where a route goes: a destination (the nearest of its rooms, for a facility), or one room on the map. */
export type RouteTarget = { destinationId: string } | { placeId: string };

export function routeToTarget(map: LoadedMap, target: RouteTarget, stepFree: boolean): Route | null {
  if ("destinationId" in target) return routeTo(map, target.destinationId, stepFree);
  const from = kioskPlace(map);
  return from ? findRoute(map, from, target.placeId, routeOptions(stepFree)) : null;
}

export function targetName(map: LoadedMap, target: RouteTarget): string | undefined {
  const id = "destinationId" in target ? target.destinationId : target.placeId;
  return destination(id)?.name ?? map.placesById.get(id)?.name;
}

const ROOM_NUMBER = /\b(\d)\s?([a-d])(?:\b|(?=\d))\W*(?:(?:room|bed|suite|no|number)\b\W*)?(\d{1,2})\b/;

/** A ward room by its number: "5A-12", "5a 12", "ward 5A bed 12", "Private Suite 7A-03". */
export function roomByNumber(map: LoadedMap, query: string): Place | undefined {
  const m = ROOM_NUMBER.exec(normalize(query));
  if (!m) return undefined;
  const suffix = ` ${m[1]}${m[2].toUpperCase()}-${m[3].padStart(2, "0")}`;
  return map.places.find((p) => p.category === "ward" && p.name.endsWith(suffix));
}

/** The ward a place is, or the ward its room belongs to ("Room 5A-12" is in Ward 5A). */
export function wardOf(place: Place): Ward | undefined {
  const code = / (\d[A-D])-\d+$/.exec(place.name)?.[1];
  return WARDS.find((w) => w.place === place.id || (code !== undefined && w.code === code));
}

function placeDetail(map: LoadedMap, place: Place): string {
  const w = wardOf(place);
  if (w) return w.place === place.id ? wardDetail(w) : `${w.name} · ${w.building}, ${w.floor}`;
  const block = /^([a-z])-/.exec(place.id)?.[1];
  return [block && `Block ${block.toUpperCase()}`, map.levelsById.get(place.levelId)?.name].filter(Boolean).join(", ");
}

/** What a visitor to a ward, or to one of its rooms, needs to know on arrival. */
export function wardNote(place: Place): string | undefined {
  const w = wardOf(place);
  if (!w) return undefined;
  return `${w.place === place.id ? w.care : `In ${w.name}`} · ${w.visiting}`;
}

function placeDestination(map: LoadedMap, place: Place): Destination {
  return { id: place.id, name: place.name, kind: "place", hint: placeDetail(map, place), keywords: [], directions: [] };
}

/** Like `matchDestination`, but a ward room's number or any other room on the map also counts. */
export function findDestination(map: LoadedMap | null, query: string): Destination | undefined {
  const room = map && roomByNumber(map, query);
  if (room) return placeDestination(map, room);
  const match = matchDestination(query);
  if (match || !map || asksForAnyWard(query)) return match;
  const [hit] = searchPlaces(map, query, 1);
  if (!hit) return undefined;
  if ("destinationId" in hit.target) return destination(hit.target.destinationId);
  return placeDestination(map, map.placesById.get(hit.target.placeId)!);
}

export type PlaceHit = {
  key: string;
  name: string;
  detail: string;
  target: RouteTarget;
  /** The room it leads to, for its badge; a facility's nearest room is only known once routed. */
  place?: Place;
  doctor?: boolean;
};

const normalize = (s: string) => s.toLowerCase().replace(/[.'’]/g, "").trim();
const wordsOf = (s: string) => normalize(s).split(/[^a-z0-9-]+/).filter(Boolean);

/** 0 the whole name, 1 its start, 2 the start of its words, 3 anywhere in it; null when it does not match. */
function nameScore(name: string, q: string, qWords: string[]): number | null {
  const n = normalize(name);
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  const words = wordsOf(name);
  if (qWords.every((w) => words.some((x) => x.startsWith(w)))) return 2;
  return n.includes(q) ? 3 : null;
}

const KEYWORD_SCORE = 4;
const KIND_ORDER = { destination: 0, doctor: 1, place: 2 } as const;

export function searchPlaces(map: LoadedMap | null, query: string, limit = 10): PlaceHit[] {
  const q = normalize(query);
  const qWords = wordsOf(query);
  if (!qWords.length) return [];
  const scored: { hit: PlaceHit; score: number; kind: keyof typeof KIND_ORDER }[] = [];

  const room = map && roomByNumber(map, query);
  if (room) {
    const hit = { key: room.id, name: room.name, detail: placeDetail(map, room), target: { placeId: room.id }, place: room };
    scored.push({ hit, score: 0, kind: "place" });
  }

  for (const d of DESTINATIONS) {
    const keywords = wordsOf(d.keywords.join(" "));
    const score =
      (d.code?.toLowerCase() === q ? 0 : null) ??
      nameScore(d.name, q, qWords) ??
      (qWords.every((w) => keywords.some((k) => k.startsWith(w))) ? KEYWORD_SCORE : null);
    if (score === null) continue;
    const dept = department(d.id);
    const place = map?.placesById.get(dept?.place ?? ward(d.id)?.place ?? "");
    const detail = dept ? `${dept.building}, ${dept.floor}` : d.hint;
    scored.push({ hit: { key: d.id, name: d.name, detail, target: { destinationId: d.id }, place }, score, kind: "destination" });
  }

  for (const doctor of DOCTORS) {
    const score = nameScore(doctor.name, q, qWords) ?? nameScore(doctor.name.replace(/^Dr\.\s*/, ""), q, qWords);
    const dept = department(doctor.department);
    if (score === null || !dept) continue;
    scored.push({
      hit: {
        key: doctor.id,
        name: doctor.name,
        detail: `${dept.name} · ${dept.building}, ${dept.floor}`,
        target: { destinationId: dept.id },
        doctor: true,
      },
      score,
      kind: "doctor",
    });
  }

  if (map) {
    const covered = new Set([kioskPlace(map), room?.id, ...DEPARTMENTS.map((d) => d.place), ...WARDS.map((w) => w.place)]);
    for (const place of map.places) {
      if (!place.searchable || place.category === "core" || covered.has(place.id) || FACILITIES.some((f) => f.matches(place))) continue;
      const score = nameScore(place.name, q, qWords);
      if (score === null) continue;
      const detail = placeDetail(map, place);
      scored.push({ hit: { key: place.id, name: place.name, detail, target: { placeId: place.id }, place }, score, kind: "place" });
    }
  }

  const levelIndex = (place?: Place) => (place && map ? map.levels.findIndex((l) => l.id === place.levelId) : 0);
  return scored
    .sort(
      (a, b) =>
        a.score - b.score ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        a.hit.name.localeCompare(b.hit.name, undefined, { numeric: true }) ||
        levelIndex(a.hit.place) - levelIndex(b.hit.place),
    )
    .slice(0, limit)
    .map((s) => s.hit);
}
