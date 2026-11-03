// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Map format: public/maps/map.schema.json. x → east, y → north, `elevation` → up, in `units` (default meters). */

export type Point = [number, number];

export interface LevelDef {
  id: string;
  name: string;
  shortName?: string;
  subtitle?: string;
  /** 0 = ground, negative = basement. */
  ordinal: number;
  /** Defaults to ordinal × 4. */
  elevation?: number;
  /** Defaults to 4. */
  height?: number;
  /** Closed ring: do not repeat the first point. */
  outline: Point[];
}

export interface RoomDef {
  id: string;
  name: string;
  level: string;
  polygon: Point[];
  category?: string;
  /** Defaults to the nearest node on the level. */
  node?: string;
  color?: string;
  icon?: string;
  height?: number;
  searchable?: boolean;
}

export interface PoiDef {
  id: string;
  name: string;
  level: string;
  x: number;
  y: number;
  category?: string;
  node?: string;
  icon?: string;
  color?: string;
}

export type NodeKind =
  | "junction"
  | "door"
  | "stairs"
  | "elevator"
  | "escalator"
  | "ramp"
  | "entrance";

export interface NodeDef {
  id: string;
  level: string;
  x: number;
  y: number;
  kind?: NodeKind;
  name?: string;
}

export type EdgeVia = "walk" | "stairs" | "elevator" | "escalator" | "ramp";

export interface EdgeDef {
  from: string;
  to: string;
  /** Level-changing edges must not be "walk". */
  via?: EdgeVia;
  oneWay?: boolean;
  weight?: number;
  accessible?: boolean;
}

export interface CategoryDef {
  label?: string;
  color?: string;
  icon?: string;
}

export interface WayfinderMap {
  $schema?: string;
  version: 1;
  name: string;
  units?: "meters" | "feet";
  /** Compass bearing of the map's +y axis, degrees clockwise from north (default 0). */
  upBearing?: number;
  attribution?: string;
  defaultStart?: string;
  categories?: Record<string, CategoryDef>;
  levels: LevelDef[];
  rooms: RoomDef[];
  pois: PoiDef[];
  nodes: NodeDef[];
  edges: EdgeDef[];
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Level extends LevelDef {
  elevation: number;
  height: number;
  bounds: Bounds;
  index: number;
}

export interface Place {
  id: string;
  name: string;
  kind: "room" | "poi";
  levelId: string;
  x: number;
  y: number;
  category: string;
  icon: string;
  color: string;
  nodeId: string;
  polygon?: Point[];
  height?: number;
  searchable: boolean;
}

export interface GraphNode extends NodeDef {
  kind: NodeKind;
  elevation: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  via: EdgeVia;
  length: number;
  cost: number;
  accessible: boolean;
}

export interface LoadedMap {
  def: WayfinderMap;
  name: string;
  units: string;
  levels: Level[];
  levelsById: Map<string, Level>;
  nodes: Map<string, GraphNode>;
  nodesByLevel: Map<string, GraphNode[]>;
  adjacency: Map<string, GraphEdge[]>;
  edges: GraphEdge[];
  places: Place[];
  placesById: Map<string, Place>;
  bounds: Bounds;
  upBearing: number;
  attribution?: string;
  defaultStart?: string;
  issues: string[];
}
