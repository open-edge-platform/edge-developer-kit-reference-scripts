// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { countOf, formatMoney, formatShortDate, hasExpired } from "@/lib/format";
import { roadTaxFor } from "@/lib/road-tax";
import { CURRENCY } from "@/app/api/_lib/registry";
import { fetchVehicles } from "@/app/api/_lib/flows/bridge";
import { ask, halt, READY } from "@/app/api/_lib/flows/plan";
import type { Ask, ChainSpec } from "@/app/api/_lib/flows/types";
import { finesWarning } from "../../chains-shared";

// Keep gates and question text in sync with the touch kiosk's steps/application.tsx.
export const chain: ChainSpec = {
  application: async (ctx) => {
    const vehicles = await fetchVehicles(ctx.documentNumber);
    if (vehicles.length === 0) {
      return halt(
        "No vehicles are registered under your name in the JPJ ownership records — road tax " +
          "can only be renewed by the registered owner. Please visit a JPJ counter if you " +
          "believe this is an error.",
      );
    }
    const warning = finesWarning(ctx.profile);
    if (warning) ctx.notes.push(warning);

    if (!ctx.data.plate && vehicles.length === 1) ctx.data.plate = vehicles[0].plateNumber;
    const vehicle = vehicles.find((v) => v.plateNumber === ctx.data.plate);

    const asks: Ask[] = [];
    if (!vehicle) {
      asks.push({
        id: "plate",
        question: "Which vehicle would you like to renew road tax for?",
        type: "options",
        options: vehicles.map((v) => ({
          value: v.plateNumber,
          label:
            `${v.plateNumber} — ${v.model} ${v.year}, ${v.engineCc}cc, road tax ` +
            `${hasExpired(v.roadTaxExpiry) ? "expired" : "expires"} ${formatShortDate(v.roadTaxExpiry)}`,
        })),
      });
    }
    if (!["6", "12"].includes(ctx.data.period)) {
      asks.push({
        id: "period",
        question: "For how long would you like to renew?",
        type: "options",
        options: [6, 12].map((months) => ({
          value: String(months),
          label: vehicle
            ? `${months} months — ${formatMoney(roadTaxFor(vehicle.engineCc, months), CURRENCY)} road tax`
            : `${months} months (price depends on the vehicle's engine capacity)`,
        })),
      });
    }
    if (asks.length > 0) {
      return ask(
        `You have ${countOf(vehicles.length, "vehicle")} registered with JPJ. Insurance is verified ` +
          "electronically via eINSURANS, and the e-LKM is issued digitally in MyJPJ.",
        asks,
      );
    }
    return READY;
  },
};
