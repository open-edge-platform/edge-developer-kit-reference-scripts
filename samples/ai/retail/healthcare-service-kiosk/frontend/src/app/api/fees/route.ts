// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { badRequest, delay } from "../_lib/http";
import { quoteFor } from "../_lib/registry";

/** Fee breakdown for a service, given the answers collected so far. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const serviceId = params.get("serviceId") ?? "";
  const data = Object.fromEntries(
    [...params.entries()].filter(([key]) => key !== "serviceId"),
  );
  const quote = await quoteFor(serviceId, data);
  if (!quote) return badRequest("unknown serviceId");
  await delay(300);
  return Response.json(quote);
}
