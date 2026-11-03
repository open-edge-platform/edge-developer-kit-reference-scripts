// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { queueSnapshots } from "../_lib/queue";
import { moduleOff } from "../_lib/modules";

/** GET /api/queue — every clinic's queue today, numbers only: the board hangs in a public waiting area. */
export async function GET() {
  const off = moduleOff("queue");
  if (off) return off;
  return Response.json({ clinics: await queueSnapshots(), at: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
