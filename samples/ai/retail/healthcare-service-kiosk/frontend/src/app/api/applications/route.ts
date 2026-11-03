// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { getService } from "@/services";
import { fileApplication } from "../_lib/applications";
import { badRequest, delay } from "../_lib/http";

export async function POST(req: Request) {
  const { serviceId, paymentId, documentNumber, data } = (await req.json().catch(() => ({}))) as {
    serviceId?: string;
    paymentId?: string;
    documentNumber?: string;
    data?: Record<string, string>;
  };
  const service = serviceId ? getService(serviceId) : null;
  if (!service) return badRequest("unknown serviceId");

  await delay();
  return Response.json(await fileApplication(service, { paymentId, documentNumber, data }));
}
