// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { getService } from "@/services";
import { chainFor } from "@/packs/index.server";
import { randomInt } from "./random";

// `locale.currency` is the real setting; `mock.currency` (KIOSK_CURRENCY) stays honoured.
export const CURRENCY =
  process.env.NEXT_PUBLIC_KIOSK_CURRENCY ?? process.env.KIOSK_CURRENCY ?? "MYR";

const PROCESSING_FEE = Number(process.env.KIOSK_PROCESSING_FEE ?? 2);

/** Fee quote: the service's chain prices it when it has a `quote`, else its flat or rated fee. */
export async function quoteFor(serviceId: string, data: Record<string, string> = {}) {
  const service = getService(serviceId);
  if (!service) return null;

  const quote = (await chainFor(service.id))?.quote;
  const rate = service.pricing?.rates[data[service.pricing.field]];
  const serviceFee = quote ? await quote(data) : (rate ?? service.fee);

  const processingFee = serviceFee > 0 && service.kioskFee !== false ? PROCESSING_FEE : 0;
  return {
    serviceId: service.id,
    currency: CURRENCY,
    serviceFee,
    processingFee,
    total: serviceFee + processingFee,
  };
}

/** The service chain's reason to route a submitted case to officer review, if any. */
export async function escalationFor(serviceId: string, data: Record<string, string>): Promise<string | null> {
  return (await chainFor(serviceId))?.escalate?.(data) ?? null;
}

export function newPaymentId(): string {
  return `PAY-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export function newCaseId(): string {
  return `HCK-${new Date().getFullYear()}-${1000 + randomInt(9000)}`;
}

export function newRequestId(): string {
  return `REQ-${new Date().getFullYear()}-${1000 + randomInt(9000)}`;
}
