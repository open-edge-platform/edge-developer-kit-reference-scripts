// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import path from "node:path";
import { loadMap } from "@/lib/wayfinding/map-loader";
import type { LoadedMap, WayfinderMap } from "@/lib/wayfinding/types";
import { asHospital, HOSPITAL_MAP } from "./wayfinding";

let loaded: LoadedMap | undefined;

/** The hospital map as the server sees it, or null while public/maps holds none. */
export function hospitalMap(): LoadedMap | null {
  if (loaded) return loaded;
  try {
    const file = path.join(process.cwd(), "public", "maps", `${HOSPITAL_MAP}.json`);
    loaded = asHospital(loadMap(JSON.parse(readFileSync(file, "utf8")) as WayfinderMap));
    return loaded;
  } catch {
    return null;
  }
}
