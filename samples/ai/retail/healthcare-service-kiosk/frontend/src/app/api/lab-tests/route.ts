// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { badRequest, param } from "../_lib/http";
import { moduleOff } from "../_lib/modules";
import { matchTests } from "@/packs/malaysia/services/clinical-information/lab-services/lab-test-pricing/lab-search";

/** GET /api/lab-tests?q= — the lab tests the patient's words could mean, by catalog search, then by the model. */
export async function GET(req: Request) {
  const off = moduleOff("labprice");
  if (off) return off;
  const q = param(req, "q");
  if (!q || q.length > 200) return badRequest("q must be 1–200 characters");
  const { tests, aiAssisted } = await matchTests(q);
  return Response.json({ testIds: tests.map((t) => t.id), aiAssisted });
}
