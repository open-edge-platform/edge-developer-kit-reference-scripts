// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { badRequest, notFound, param } from "../../_lib/http";
import { describeSets, mockSets } from "../../_lib/mock-document-sets";
import { notStaff, staffUser } from "../../_lib/staff";

// Staff-only, on the CMS admin session — see ../../_lib/staff.

/** `citizen` is the registry row id the staff citizen search returns. */
export async function GET(req: Request) {
  if (!(await staffUser(req))) return notStaff();
  const id = Number(param(req, "citizen"));
  if (!Number.isInteger(id) || id <= 0) return badRequest("citizen must be a registry row id");

  const sets = await mockSets(id);
  if (!sets) return notFound("nobody on the register has that id");
  return Response.json(describeSets(sets), { headers: { "cache-control": "no-store" } });
}
