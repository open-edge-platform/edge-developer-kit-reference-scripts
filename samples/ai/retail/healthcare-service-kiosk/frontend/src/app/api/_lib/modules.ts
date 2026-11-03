// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { moduleEnabled } from "@/modules/state";

/** A 404 for a route whose module this terminal has switched off (config.yaml `modules`), else null. */
export function moduleOff(id: string): Response | null {
  if (moduleEnabled(id)) return null;
  return Response.json({ error: `${id} is switched off on this kiosk` }, { status: 404 });
}
