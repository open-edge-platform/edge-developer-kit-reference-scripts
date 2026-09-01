// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { badRequest, delay, oneOf, readJson } from "../_lib/http";
import { cmsCreate } from "../_lib/cms";
import { findCitizenByDocument } from "../_lib/citizens";
import { findUnpaidFines, isFineLookupBy, settleFines } from "../_lib/fines";
import { newPaymentId, quoteFor } from "../_lib/registry";

const METHODS = ["card", "qr", "cash"] as const;

/** Capture payment for a service and settle anything the fee covers. */
export async function POST(req: Request) {
  const { serviceId, method, data, documentNumber } = await readJson<{
    serviceId: string;
    method: string;
    data: Record<string, string>;
    documentNumber: string;
  }>(req);

  const quote = serviceId ? await quoteFor(serviceId, data) : null;
  if (!quote) return badRequest("unknown serviceId");
  const checked = oneOf(method, METHODS, "method");
  if (!checked.ok) return checked.response;
  if (quote.total <= 0) return badRequest("this service has no fee to pay");

  await delay();
  const paymentId = newPaymentId();
  const paidAt = new Date().toISOString();
  const citizen = documentNumber ? await findCitizenByDocument(documentNumber) : null;

  await cmsCreate("payments", {
    paymentId,
    serviceId: quote.serviceId,
    citizen: citizen?.id ?? null,
    method: checked.value,
    amount: quote.total,
    currency: quote.currency,
    breakdown: { serviceFee: quote.serviceFee, processingFee: quote.processingFee },
    paidAt,
  });

  // Paying the saman service settles the summonses that were quoted.
  if (quote.serviceId === "fine") {
    const { lookupBy = "", reference = "" } = data ?? {};
    if (isFineLookupBy(lookupBy) && reference) {
      await settleFines(await findUnpaidFines(lookupBy, reference), paymentId);
    }
  }

  return Response.json({
    paymentId,
    serviceId: quote.serviceId,
    method: checked.value,
    amount: quote.total,
    currency: quote.currency,
    paidAt,
  });
}
