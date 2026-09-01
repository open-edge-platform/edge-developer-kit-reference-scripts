// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ask, halt, READY } from "@/app/api/_lib/flows/plan";
import type { Ask, ChainSpec } from "@/app/api/_lib/flows/types";

// Keep gates and question text in sync with the touch kiosk's steps/application.tsx.
export const chain: ChainSpec = {
  application: (ctx) => {
    if (ctx.profile.religion === "Islam") {
      return halt(
        "Registry records show you are Muslim — civil marriage under the Law Reform " +
          "(Marriage and Divorce) Act 1976 applies to non-Muslims only. Please apply through " +
          "your State Islamic Religious Department (Jabatan Agama Islam / Syariah Court).",
      );
    }
    if (ctx.profile.maritalStatus === "married") {
      return halt(
        "NRD records show you are currently married — a new notice of marriage (JPN.KC02) " +
          "cannot be filed until the existing marriage is dissolved. Please visit a JPN " +
          "counter with your divorce or death certificate.",
      );
    }
    if (ctx.profile.age < 21) {
      ctx.notes.push(
        `The registry shows you are ${ctx.profile.age} — applicants aged 18–20 must attach ` +
          "form KC01B (parental consent) with their documents.",
      );
    }
    const asks: Ask[] = [];
    const venues = [
      { value: "office", label: "JPN office — RM30" },
      { value: "worship", label: "House of worship (appointed registrar) — RM30" },
      { value: "other", label: "Other venue (home/hotel) — KC01E licence, RM530 total" },
    ];
    if (!venues.some((v) => v.value === ctx.data.venueType)) {
      asks.push({
        id: "venueType",
        question: "Where do you intend to solemnize the marriage?",
        type: "options",
        options: venues,
      });
    }
    if (!ctx.data.date?.trim()) {
      asks.push({
        id: "date",
        question: "What is the intended ceremony date?",
        type: "text",
        placeholder: "e.g. 12 Sep 2026",
      });
    }
    if (!ctx.data.witness1?.trim()) {
      asks.push({
        id: "witness1",
        question: "Who is your first witness (full name)?",
        type: "text",
        placeholder: "Full name",
      });
    }
    if (!ctx.data.witness2?.trim()) {
      asks.push({
        id: "witness2",
        question: "Who is your second witness (full name)?",
        type: "text",
        placeholder: "Full name",
      });
    }
    if (asks.length > 0) {
      return ask(
        "Your notice of marriage is displayed at JPN for 21 days; the ceremony takes place " +
          "after that and within 6 months of this application. Two credible witnesses are " +
          "required.",
        asks,
      );
    }
    return READY;
  },
};
