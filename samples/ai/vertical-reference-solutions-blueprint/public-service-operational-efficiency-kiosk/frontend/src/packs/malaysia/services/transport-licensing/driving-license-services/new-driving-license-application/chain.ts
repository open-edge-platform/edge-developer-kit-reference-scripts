// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { plural } from "@/lib/format";
import { fetchLicenses, type LicenseRecord } from "@/app/api/_lib/flows/bridge";
import { ask, done, READY } from "@/app/api/_lib/flows/plan";
import type { ChainSpec } from "@/app/api/_lib/flows/types";

// Keep gates and question text in sync with the touch kiosk's steps/application.tsx.
export const chain: ChainSpec = {
  application: async (ctx) => {
    const licenses = await fetchLicenses(ctx.documentNumber);
    const held = new Set(licenses.filter((l) => !l.cancelled).map((l) => l.licenseClass));
    const age = ctx.profile.age;
    const classes: { value: LicenseRecord["licenseClass"]; label: string; minAge: number }[] = [
      { value: "B2", label: "B2 · Motorcycle up to 250cc — age 16+, PDL RM2", minAge: 16 },
      { value: "D", label: "D · Car (manual) up to 3,500 kg — age 17+, PDL RM60", minAge: 17 },
      { value: "DA", label: "DA · Car (automatic only) — age 17+, PDL RM60", minAge: 17 },
    ];
    // D covers automatics, so a D holder can't take DA; a DA holder taking D is an upgrade.
    const options = classes.filter(
      (c) =>
        age >= c.minAge && !held.has(c.value) && !(c.value === "DA" && held.has("D")),
    );
    if (options.length === 0) {
      return done(
        "You already hold every license class this kiosk can issue — use the Driving License " +
          "Renewal service to extend an existing license.",
      );
    }
    if (held.size > 0) {
      ctx.notes.push(
        `JPJ records show you already hold ${plural(held.size, "class", "classes")} ` +
          `${[...held].join(", ")} — only classes you don't hold are offered.`,
      );
    }
    if (!options.some((c) => c.value === ctx.data.licenseClass)) {
      return ask(
        "You must have passed the KPP01 theory test and the JPJ practical test for the class " +
          "you apply for. Your license starts as a 2-year Probationary (P) license.",
        [
          {
            id: "licenseClass",
            question: "Which license class are you applying for?",
            type: "options",
            options,
          },
        ],
      );
    }
    return READY;
  },
};
