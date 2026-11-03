// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ask, done } from "@/app/api/_lib/flows/plan";
import type { Ask, ChainSpec } from "@/app/api/_lib/flows/types";
import { takenSlots } from "@/app/api/_lib/patients";
import { doctorsCalled, type Doctor } from "@/hospital/data";
import { formatShortDate } from "@/lib/format";
import { resultMessage } from "@/services/shared/result";
import {
  LANGUAGE_OPTIONS,
  SPECIALTY_OPTIONS,
  doctorSearchResult,
  doctorsFor,
  namedDoctorsResult,
  nextClinicDays,
  nextFree,
} from "./search";

/** "Availability": each doctor's next free slot, with what's already booked taken out. */
async function availabilityOf(doctors: Doctor[]): Promise<Record<string, string>> {
  const entries = await Promise.all(
    doctors.map(async (d) => [d.id, nextFree(nextClinicDays(d, new Date(), 5, await takenSlots(d.id)), formatShortDate)] as const),
  );
  return Object.fromEntries(entries);
}

export const chain: ChainSpec = {
  application: async (ctx) => {
    // Spoken, so a name may come through a letter off; the touch search matches what is typed.
    const named = doctorsCalled(ctx.data.name ?? "");
    if (named.length > 0) return done(resultMessage(namedDoctorsResult(named, await availabilityOf(named))));

    const spoken = LANGUAGE_OPTIONS.find((l) => l.toLowerCase() === ctx.data.language?.trim().toLowerCase());
    if (spoken) ctx.data.language = spoken;
    const asks: Ask[] = [];
    if (!SPECIALTY_OPTIONS.some((d) => d.id === ctx.data.department)) {
      asks.push({
        id: "department",
        question: "Which specialty are you looking for?",
        type: "options",
        options: SPECIALTY_OPTIONS.map((d) => ({ value: d.id, label: d.name })),
      });
    }
    if (!LANGUAGE_OPTIONS.includes(ctx.data.language)) {
      asks.push({
        id: "language",
        question: "Do you have a preferred consulting language?",
        type: "options",
        options: LANGUAGE_OPTIONS.map((l) => ({ value: l, label: l === "any" ? "Any language" : l })),
      });
    }
    if (asks.length > 0) {
      return ask(ctx.data.name ? `I couldn't find a doctor called "${ctx.data.name}".` : undefined, asks);
    }
    const shown = doctorsFor(ctx.data.department, ctx.data.language);
    const list = shown.length > 0 ? shown : doctorsFor(ctx.data.department, "any");
    return done(resultMessage(doctorSearchResult(ctx.data.department, ctx.data.language, await availabilityOf(list))));
  },
};
