// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { badRequest, param } from "../../_lib/http";
import { ticketStatus } from "../../_lib/queue";
import { moduleOff } from "../../_lib/modules";

/** GET /api/queue/ticket?department=…&number=… — how far a ticket is from being called. */
export async function GET(req: Request) {
  const off = moduleOff("queue");
  if (off) return off;
  const department = param(req, "department");
  const number = param(req, "number").toUpperCase();
  if (!department || !number) return badRequest("department and number are required");
  return Response.json(await ticketStatus(department, number), { headers: { "cache-control": "no-store" } });
}
