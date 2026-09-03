// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ask, READY } from "@/app/api/_lib/flows/plan";
import type { Ask, ChainSpec } from "@/app/api/_lib/flows/types";

// Keep gates and question text in sync with the touch kiosk's steps/application.tsx.
export const chain: ChainSpec = {
  application: (ctx) => {
    if (ctx.profile.requiresOfficerReview) {
      ctx.notes.push(
        "An open case is attached to your registry record — your application will be routed " +
          "to a PDRM officer for manual vetting before the certificate can be released.",
      );
    }
    const asks: Ask[] = [];
    const purposes = [
      { value: "studies", label: "Further studies" },
      { value: "working", label: "Working" },
      { value: "family", label: "Accompanying family" },
      { value: "pr", label: "Permanent resident application" },
      { value: "citizenship", label: "Citizenship application" },
      { value: "others", label: "Others" },
    ];
    if (!purposes.some((p) => p.value === ctx.data.purpose)) {
      asks.push({
        id: "purpose",
        question: "What is the purpose of the certificate? It is printed on the certificate.",
        type: "options",
        options: purposes,
      });
    }
    if (!ctx.data.country?.trim()) {
      asks.push({
        id: "country",
        question: "Which destination country is the certificate for?",
        type: "text",
        placeholder: "e.g. Singapore",
      });
    }
    if (asks.length > 0) {
      return ask(
        "PDRM vetting takes about 1–3 months; the digital certificate is then issued for " +
          "download and is valid for 1 year.",
        asks,
      );
    }
    return READY;
  },
};
