// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { getService } from "@/services";
import { roadTaxFor } from "@/lib/road-tax";
import { findUnpaidFines, isFineLookupBy, sumFines } from "./fines";
import { randomInt } from "./random";
import { findVehicleByPlate } from "./vehicles";

// `locale.currency` is the real setting; `mock.currency` (KIOSK_CURRENCY) stays honoured.
export const CURRENCY =
  process.env.NEXT_PUBLIC_KIOSK_CURRENCY ?? process.env.KIOSK_CURRENCY ?? "MYR";

const PROCESSING_FEE = Number(process.env.KIOSK_PROCESSING_FEE ?? 2);

/** Fee quote. Fine and road tax are registry-priced rather than flat-rated. */
export async function quoteFor(serviceId: string, data: Record<string, string> = {}) {
  const service = getService(serviceId);
  if (!service) return null;

  let serviceFee: number;
  if (service.id === "fine") {
    serviceFee = await outstandingAmount(data);
  } else if (service.id === "roadtax") {
    serviceFee = await roadTaxAmount(data, service.fee);
  } else {
    const rate = service.pricing?.rates[data[service.pricing.field]];
    serviceFee = rate ?? service.fee;
  }

  const processingFee = serviceFee > 0 ? PROCESSING_FEE : 0;
  return {
    serviceId: service.id,
    currency: CURRENCY,
    serviceFee,
    processingFee,
    total: serviceFee + processingFee,
  };
}

/** Total of unpaid summonses matching the saman lookup collected in-flow. */
async function outstandingAmount(data: Record<string, string>): Promise<number> {
  const { lookupBy = "", reference = "" } = data;
  if (!isFineLookupBy(lookupBy) || !reference) return 0;
  return sumFines(await findUnpaidFines(lookupBy, reference));
}

/** Road tax from the registered vehicle's engine capacity and chosen period. */
async function roadTaxAmount(data: Record<string, string>, fallback: number): Promise<number> {
  const vehicle = data.plate ? await findVehicleByPlate(data.plate) : null;
  if (!vehicle) return fallback;
  return roadTaxFor(vehicle.engineCc, Number(data.period ?? "12"));
}

export function newPaymentId(): string {
  return `PAY-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export function newCaseId(): string {
  return `PSK-${new Date().getFullYear()}-${1000 + randomInt(9000)}`;
}

export function newRequestId(): string {
  return `REQ-${new Date().getFullYear()}-${1000 + randomInt(9000)}`;
}
