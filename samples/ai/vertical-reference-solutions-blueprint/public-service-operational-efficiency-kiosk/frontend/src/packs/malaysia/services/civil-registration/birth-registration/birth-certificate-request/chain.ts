// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ask, READY } from "@/app/api/_lib/flows/plan";
import type { Ask, ChainSpec } from "@/app/api/_lib/flows/types";

// Keep gates and question text in sync with the touch kiosk's steps/application.tsx.
const LATE_AFTER_DAYS = 60;

export const chain: ChainSpec = {
  application: (ctx) => {
    const asks: Ask[] = [];
    if (!ctx.data.childName?.trim()) {
      asks.push({
        id: "childName",
        question: "What is the child's full name, exactly as on the hospital birth confirmation?",
        type: "text",
        placeholder: "Full name",
      });
    }
    if (!ctx.data.childDob?.trim()) {
      asks.push({
        id: "childDob",
        question: "What is the child's date of birth?",
        type: "text",
        placeholder: "e.g. 02 Jul 2026",
      });
    }
    if (!ctx.data.birthPlace?.trim()) {
      asks.push({
        id: "birthPlace",
        question: "Where was the child born?",
        type: "text",
        placeholder: "Hospital or address",
      });
    }
    if (asks.length > 0) {
      return ask(
        "Registration is free within 60 days of birth; late registration costs RM50 and needs " +
          "extra documents. Home births need a doctor's letter and a police report.",
        asks,
      );
    }
    // The manual timing question is only a fallback for when the date of birth can't be parsed.
    const parsed = Date.parse(ctx.data.childDob.trim());
    if (Number.isNaN(parsed)) {
      if (!["normal", "late"].includes(ctx.data.timing)) {
        return ask(undefined, [
          {
            id: "timing",
            question: "I couldn't read that date — was the child born within the last 60 days?",
            type: "options",
            options: [
              { value: "normal", label: "Within 60 days — free" },
              { value: "late", label: "More than 60 days ago — RM50, extra documents required" },
            ],
          },
        ]);
      }
    } else {
      const days = Math.floor((Date.now() - parsed) / 86_400_000);
      ctx.data.timing = days > LATE_AFTER_DAYS ? "late" : "normal";
      ctx.notes.push(
        ctx.data.timing === "late"
          ? `This birth was ${days} days ago — past the 60-day window, so the RM50 ` +
              "late-registration fee and extra documents apply."
          : "This birth is within the 60-day registration window — registration is free.",
      );
    }
    return READY;
  },
};
