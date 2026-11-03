// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { MODULES } from "@/modules/manifest";
import { enabledModules } from "@/modules/state";
import { allServices } from "@/services/catalog";

/** GET /api/modules — every module of this kiosk and whether it runs (config.yaml `modules`). */
export function GET() {
  const on = enabledModules();
  const ids = [...MODULES.filter((m) => m.kind !== "service").map((m) => m.id), ...allServices().map((s) => s.id)];
  return Response.json(Object.fromEntries(ids.map((id) => [id, on(id)])), {
    headers: { "cache-control": "no-store" },
  });
}
