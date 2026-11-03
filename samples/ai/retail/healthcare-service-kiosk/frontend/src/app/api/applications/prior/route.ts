// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { badRequest } from "../../_lib/http";
import { findPriorCase } from "../../_lib/prior-case";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const serviceId = url.searchParams.get("serviceId");
  const documentNumber = url.searchParams.get("documentNumber")?.trim().toUpperCase();
  if (!serviceId || !documentNumber) return badRequest("serviceId and documentNumber are required");
  const prior = await findPriorCase(serviceId, documentNumber);
  // The case's answers (phones, contacts) stay server-side.
  return Response.json({
    prior: prior && { caseId: prior.caseId, status: prior.status, submittedAt: prior.submittedAt },
  });
}
