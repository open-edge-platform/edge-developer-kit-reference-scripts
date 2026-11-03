// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { callRoute } from "../route-call";
import { GET as feesRoute } from "../../fees/route";

/** Typed registry lookups over the kiosk routes, for the chain specs. */

export type FeeQuote = {
  serviceId: string;
  currency: string;
  serviceFee: number;
  processingFee: number;
  total: number;
};

export async function fetchQuote(
  serviceId: string,
  data: Record<string, string>,
): Promise<FeeQuote> {
  const res = await callRoute(feesRoute, { params: { serviceId, ...data } });
  if (!res.ok) throw new Error("the fee quote could not be computed");
  return res.body as FeeQuote;
}
