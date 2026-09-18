// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { formatMoney } from "@/lib/format";
import { CURRENCY } from "@/app/api/_lib/registry";
import { ask, halt, READY } from "@/app/api/_lib/flows/plan";
import type { ChainSpec } from "@/app/api/_lib/flows/types";

// Keep gates and question text in sync with the touch kiosk's steps/application.tsx.
/** Replacement fee tiers by cumulative loss count; capped at the third. */
const LOSS_FEES: Record<number, number> = { 1: 110, 2: 310, 3: 1010 };

export const chain: ChainSpec = {
  application: (ctx) => {
    if (ctx.profile.country !== "Malaysia") {
      return halt(
        "MyKad is issued to Malaysian citizens under the National Registration Regulations — " +
          "your record shows a foreign passport. Please contact the Immigration Department " +
          "(JIM) or your embassy for foreign identity documents.",
      );
    }
    const priorLosses = ctx.profile.idCardLossCount;
    const lossTier = Math.min(priorLosses + 1, 3);
    const cases = [
      // First MyKad is only offered around the 12th birthday.
      ...(ctx.profile.age <= 12
        ? [{ value: "first", label: "First MyKad (age 12) — free within 30 days of birthday" }]
        : []),
      {
        value: "lost",
        label:
          `Lost card — loss #${priorLosses + 1} on your record, fee ` +
          `${formatMoney(LOSS_FEES[lossTier], CURRENCY)}` +
          (priorLosses >= 1 ? " (police report required)" : ""),
      },
      { value: "damaged", label: "Damaged card — RM10, free within 12 months of issue" },
      { value: "update", label: "Change of particulars (form JPN.KP16) — RM20" },
    ];
    if (!cases.some((c) => c.value === ctx.data.caseType)) {
      return ask(
        "A police report is compulsory from the second loss, or for any loss through crime.",
        [
          {
            id: "caseType",
            question: "What do you need for your MyKad?",
            type: "options",
            options: cases,
          },
        ],
      );
    }
    return READY;
  },
  finalize: (ctx) => {
    const lost = ctx.data.caseType === "lost";
    const tier = Math.min(ctx.profile.idCardLossCount + 1, 3);
    return {
      lossCount: lost ? String(ctx.profile.idCardLossCount + 1) : "",
      priceKey: lost ? `lost${tier}` : ctx.data.caseType,
    };
  },
};
