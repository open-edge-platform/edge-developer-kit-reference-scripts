// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { countOf, formatMoney, formatShortDate, hasExpired } from "@/lib/format";
import { CURRENCY } from "@/app/api/_lib/registry";
import { fetchLicenses, type LicenseRecord } from "@/app/api/_lib/flows/bridge";
import { ask, halt, READY } from "@/app/api/_lib/flows/plan";
import type { Ask, ChainSpec } from "@/app/api/_lib/flows/types";
import { finesWarning } from "../../chains-shared";

const CLASS_LABELS: Record<LicenseRecord["licenseClass"], string> = {
  B2: "B2 · Motorcycle",
  D: "D · Car (Manual)",
  DA: "DA · Car (Auto)",
};

// Keep gates and question text in sync with the touch kiosk's steps/application.tsx.
export const chain: ChainSpec = {
  application: async (ctx) => {
    const licenses = await fetchLicenses(ctx.documentNumber);
    if (licenses.length === 0) {
      return halt(
        "No driving license is registered under your name in the JPJ records — use the " +
          "New Driving License Application service instead.",
      );
    }
    const renewable = licenses.filter((l) => !l.cancelled);
    if (renewable.length === 0) {
      return halt(
        "All licenses on record expired more than 3 years ago and are cancelled under the " +
          "Road Transport Act — you must retake KPP02/KPP03 at a driving institute; renewal " +
          "is not possible at this kiosk.",
      );
    }
    const warning = finesWarning(ctx.profile);
    if (warning) ctx.notes.push(warning);

    if (!ctx.data.licenseClass && renewable.length === 1) {
      ctx.data.licenseClass = renewable[0].licenseClass;
    }
    const license = renewable.find((l) => l.licenseClass === ctx.data.licenseClass);

    const asks: Ask[] = [];
    if (!license) {
      asks.push({
        id: "licenseClass",
        question: "Which license is this for?",
        type: "options",
        options: renewable.map((l) => ({
          value: l.licenseClass,
          label:
            `${CLASS_LABELS[l.licenseClass]} — ${l.licenseNo}, ` +
            `${hasExpired(l.expiresAt) ? "expired" : "expires"} ${formatShortDate(l.expiresAt)}`,
        })),
      });
    }
    if (!["renewal", "replacement"].includes(ctx.data.requestType)) {
      asks.push({
        id: "requestType",
        question: "Do you need a renewal or a replacement card?",
        type: "options",
        options: [
          { value: "renewal", label: "Renewal — extend validity, RM30 per year" },
          { value: "replacement", label: "Replacement — lost or damaged card, RM20" },
        ],
      });
    }
    const needsDuration =
      ctx.data.requestType !== "replacement" && !["1", "2", "3", "5"].includes(ctx.data.duration);
    if (needsDuration) {
      asks.push({
        id: "duration",
        question: "Renew for how many years?",
        type: "options",
        options: [1, 2, 3, 5].map((years) => ({
          value: String(years),
          label: `${countOf(years, "year")} — ${formatMoney(years * 30, CURRENCY)}`,
        })),
        // Only applies when the previous answer is (or will be) "renewal".
        optional: !ctx.data.requestType,
      });
    }
    if (asks.length > 0) {
      return ask(
        "A license expired for more than 3 years is cancelled under the Road Transport Act " +
          "and cannot be renewed here.",
        asks,
      );
    }
    return READY;
  },
  finalize: (ctx) => ({
    duration: ctx.data.requestType === "renewal" ? ctx.data.duration : "",
    priceKey: ctx.data.requestType === "replacement" ? "replace" : ctx.data.duration,
  }),
};
