// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ask, halt, READY } from "@/app/api/_lib/flows/plan";
import type { Ask, ChainSpec } from "@/app/api/_lib/flows/types";

// Keep gates and question text in sync with the touch kiosk's steps/application.tsx.
export const chain: ChainSpec = {
  application: (ctx) => {
    const p = ctx.profile;
    const schemes = [
      ...(p.childrenUnder18 > 0
        ? [{ value: "bkk", label: "BKK · Child Aid — RM250/child ≤6, RM200 ages 7–18 (max RM1,000)" }]
        : []),
      ...(p.age >= 60
        ? [{ value: "bwe", label: "BWE · Senior Citizen — RM600/month, age 60+" }]
        : []),
      ...(p.isOku
        ? [
            { value: "btb", label: "BTB · OKU Unable to Work — RM300/month" },
            { value: "epoku", label: "EPOKU · OKU Worker — RM450/month, income RM100–1,700" },
          ]
        : []),
    ];
    if (schemes.length === 0) {
      return halt(
        `Based on your registry record (age ${p.age}, no OKU registration or dependent ` +
          "children on file), none of the kiosk's federal aid schemes apply. Visit a JKM " +
          "office if your circumstances have changed — for example to register as OKU or " +
          "update your dependents.",
      );
    }
    const asks: Ask[] = [];
    if (!schemes.some((s) => s.value === ctx.data.scheme)) {
      asks.push({
        id: "scheme",
        question: "Which JKM aid scheme are you applying for? Your record qualifies for these:",
        type: "options",
        options: schemes,
      });
    }
    if (!ctx.data.income?.trim()) {
      asks.push({
        id: "income",
        question:
          "What is your monthly household income in RM?" +
          (p.monthlyIncome > 0
            ? ` (Registry income on file: RM${p.monthlyIncome.toLocaleString()} — your ` +
              "declaration is cross-checked against LHDN records.)"
            : ""),
        type: "text",
        placeholder: "e.g. 2400",
      });
    }
    if (asks.length > 0) {
      return ask(
        "Eligibility is means-tested against the Poverty Line Income plus a JKM field " +
          "investigation. Application is free; expect a decision about 30 working days after " +
          "documents are complete.",
        asks,
      );
    }
    return READY;
  },
};
