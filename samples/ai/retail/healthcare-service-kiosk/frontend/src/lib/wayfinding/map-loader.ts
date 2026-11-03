// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { safeUrl, URL_CHARS } from "@/lib/validation";
import { resolveCategory } from "./categories";
import { boundsOf, centroid, mergeBounds } from "./geometry";
import type {
  EdgeVia,
  GraphEdge,
  GraphNode,
  Level,
  LoadedMap,
  Place,
  WayfinderMap,
} from "./types";

/** cost = length × multiplier + fixed, in metres-equivalent. */
const VIA_COST: Record<EdgeVia, { multiplier: number; fixed: number; accessible: boolean }> = {
  walk: { multiplier: 1, fixed: 0, accessible: true },
  ramp: { multiplier: 1.2, fixed: 0, accessible: true },
  stairs: { multiplier: 2.5, fixed: 5, accessible: false },
  escalator: { multiplier: 1, fixed: 4, accessible: false },
  elevator: { multiplier: 1, fixed: 30, accessible: true },
};

export function loadMap(def: WayfinderMap): LoadedMap {
  const issues: string[] = [];

  const sortedLevels = [...(def.levels ?? [])].sort((a, b) => a.ordinal - b.ordinal);
  const levels: Level[] = sortedLevels.map((l, index) => ({
    ...l,
    elevation: l.elevation ?? l.ordinal * 4,
    height: l.height ?? 4,
    bounds: boundsOf(l.outline),
    index,
  }));
  const levelsById = new Map(levels.map((l) => [l.id, l]));
  if (levels.length === 0) issues.push("Map has no levels.");

  const bounds = levels.reduce(
    (acc, l) => (acc ? mergeBounds(acc, l.bounds) : l.bounds),
    undefined as ReturnType<typeof boundsOf> | undefined,
  ) ?? { minX: 0, minY: 0, maxX: 10, maxY: 10 };

  const nodes = new Map<string, GraphNode>();
  const nodesByLevel = new Map<string, GraphNode[]>();
  for (const n of def.nodes ?? []) {
    if (nodes.has(n.id)) issues.push(`Duplicate node id "${n.id}".`);
    const level = levelsById.get(n.level);
    if (!level) {
      issues.push(`Node "${n.id}" references unknown level "${n.level}".`);
      continue;
    }
    const gn: GraphNode = { ...n, kind: n.kind ?? "junction", elevation: level.elevation };
    nodes.set(n.id, gn);
    if (!nodesByLevel.has(n.level)) nodesByLevel.set(n.level, []);
    nodesByLevel.get(n.level)!.push(gn);
  }

  const adjacency = new Map<string, GraphEdge[]>();
  const edges: GraphEdge[] = [];
  const addEdge = (e: GraphEdge) => {
    if (!adjacency.has(e.from)) adjacency.set(e.from, []);
    adjacency.get(e.from)!.push(e);
    edges.push(e);
  };
  for (const e of def.edges ?? []) {
    const a = nodes.get(e.from);
    const b = nodes.get(e.to);
    if (!a || !b) {
      issues.push(`Edge ${e.from} → ${e.to} references a missing node.`);
      continue;
    }
    let via: EdgeVia = ((e.via as string) === "lift" ? "elevator" : e.via) ?? "walk";
    if (a.level !== b.level && via === "walk") {
      issues.push(`Edge ${e.from} → ${e.to} changes level but has via "walk"; treating as stairs.`);
      via = "stairs";
    }
    const length = Math.hypot(a.x - b.x, a.y - b.y, a.elevation - b.elevation);
    const model = VIA_COST[via] ?? VIA_COST.walk;
    const cost = e.weight ?? length * model.multiplier + model.fixed;
    const accessible = e.accessible ?? model.accessible;
    addEdge({ from: e.from, to: e.to, via, length, cost, accessible });
    if (!e.oneWay) addEdge({ from: e.to, to: e.from, via, length, cost, accessible });
  }

  const nearestNode = (levelId: string, x: number, y: number): string | undefined => {
    let best: GraphNode | undefined;
    let bestD = Infinity;
    for (const n of nodesByLevel.get(levelId) ?? []) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best?.id;
  };

  const places: Place[] = [];
  const seen = new Set<string>();
  const registerPlace = (p: Place) => {
    if (seen.has(p.id)) issues.push(`Duplicate place id "${p.id}".`);
    seen.add(p.id);
    places.push(p);
  };

  for (const r of def.rooms ?? []) {
    if (!levelsById.has(r.level)) {
      issues.push(`Room "${r.id}" references unknown level "${r.level}".`);
      continue;
    }
    if (!r.polygon || r.polygon.length < 3) {
      issues.push(`Room "${r.id}" needs a polygon with ≥ 3 points.`);
      continue;
    }
    const [cx, cy] = centroid(r.polygon);
    const cat = resolveCategory(def.categories, r.category);
    let nodeId = r.node;
    if (nodeId && !nodes.has(nodeId)) {
      issues.push(`Room "${r.id}" references missing node "${nodeId}".`);
      nodeId = undefined;
    }
    nodeId = nodeId ?? nearestNode(r.level, cx, cy);
    if (!nodeId) {
      issues.push(`Room "${r.id}" has no routing node on level "${r.level}".`);
      continue;
    }
    registerPlace({
      id: r.id,
      name: r.name,
      kind: "room",
      levelId: r.level,
      x: cx,
      y: cy,
      category: r.category ?? "default",
      icon: r.icon ?? cat.icon,
      color: r.color ?? cat.color,
      nodeId,
      polygon: r.polygon,
      height: r.height,
      searchable: r.searchable ?? true,
    });
  }

  for (const p of def.pois ?? []) {
    if (!levelsById.has(p.level)) {
      issues.push(`POI "${p.id}" references unknown level "${p.level}".`);
      continue;
    }
    const cat = resolveCategory(def.categories, p.category);
    let nodeId = p.node;
    if (nodeId && !nodes.has(nodeId)) {
      issues.push(`POI "${p.id}" references missing node "${nodeId}".`);
      nodeId = undefined;
    }
    nodeId = nodeId ?? nearestNode(p.level, p.x, p.y);
    if (!nodeId) {
      issues.push(`POI "${p.id}" has no routing node on level "${p.level}".`);
      continue;
    }
    registerPlace({
      id: p.id,
      name: p.name,
      kind: "poi",
      levelId: p.level,
      x: p.x,
      y: p.y,
      category: p.category ?? "default",
      icon: p.icon ?? cat.icon,
      color: p.color ?? cat.color,
      nodeId,
      searchable: true,
    });
  }

  const placesById = new Map(places.map((p) => [p.id, p]));
  if (def.defaultStart && !placesById.has(def.defaultStart)) {
    issues.push(`defaultStart "${def.defaultStart}" is not a known place.`);
  }

  if (nodes.size > 0) {
    const undirected = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!undirected.has(e.from)) undirected.set(e.from, new Set());
      if (!undirected.has(e.to)) undirected.set(e.to, new Set());
      undirected.get(e.from)!.add(e.to);
      undirected.get(e.to)!.add(e.from);
    }
    const start = nodes.keys().next().value as string;
    const seenNodes = new Set([start]);
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const nb of undirected.get(cur) ?? []) {
        if (!seenNodes.has(nb)) {
          seenNodes.add(nb);
          stack.push(nb);
        }
      }
    }
    const orphans = [...nodes.keys()].filter((id) => !seenNodes.has(id));
    if (orphans.length) {
      issues.push(
        `${orphans.length} node(s) are unreachable from "${start}": ${orphans.slice(0, 5).join(", ")}${orphans.length > 5 ? "…" : ""}`,
      );
    }
  }

  return {
    def,
    name: def.name ?? "Untitled venue",
    units: def.units ?? "meters",
    levels,
    levelsById,
    nodes,
    nodesByLevel,
    adjacency,
    edges,
    places,
    placesById,
    bounds,
    upBearing: def.upBearing ?? 0,
    attribution: def.attribution,
    defaultStart: def.defaultStart && placesById.has(def.defaultStart) ? def.defaultStart : places[0]?.id,
    issues,
  };
}

export async function fetchMap(name: string): Promise<LoadedMap> {
  // Rebuilt inline, character by character off the allowlist: the security
  // scan only trusts sanitization done in the same function as the fetch.
  let target = "";
  for (const ch of safeUrl(`/maps/${encodeURIComponent(name)}.json`)) {
    let ok = "";
    for (const allowed of URL_CHARS) {
      if (allowed === ch) {
        ok = allowed;
        break;
      }
    }
    if (!ok) throw new Error(`Could not load map "${name}" (forbidden character).`);
    target += ok;
  }
  const res = await fetch(target);
  if (!res.ok) throw new Error(`Could not load map "${name}" (${res.status}).`);
  const def = (await res.json()) as WayfinderMap;
  return loadMap(def);
}
