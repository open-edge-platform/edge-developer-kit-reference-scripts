// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { fileApplication } from "@/app/api/_lib/applications";
import { ask, done } from "@/app/api/_lib/flows/plan";
import type { Ask, ChainSpec } from "@/app/api/_lib/flows/types";
import { resultMessage } from "@/services/shared/result";
import { AREA_OPTIONS, RATING_OPTIONS, feedbackEscalation, feedbackResult, triageData } from "./outcome";
import { triageFeedback } from "./triage";

export const chain: ChainSpec = {
  application: async (ctx) => {
    const ratingKnown = RATING_OPTIONS.some((r) => r.value === ctx.data.rating);
    const areaKnown = AREA_OPTIONS.includes(ctx.data.area);

    // The comment is what the sentiment analysis reads, so it is always offered — even when rating and area came at once.
    if (!ratingKnown || !areaKnown || ctx.data.comment === undefined) {
      const asks: Ask[] = [];
      if (!ratingKnown) {
        asks.push({
          id: "rating",
          question: "How would you rate your visit today?",
          type: "options",
          options: RATING_OPTIONS,
        });
      }
      if (!areaKnown) {
        asks.push({
          id: "area",
          question: "Which area is this feedback about?",
          type: "options",
          options: AREA_OPTIONS.map((a) => ({ value: a, label: a })),
        });
      }
      // Offered alongside the required questions so it can be answered or skipped in the same round.
      if (ctx.data.comment === undefined) {
        asks.push({
          id: "comment",
          question: "Any comments you'd like to add? Reply \"skip\" to leave this blank.",
          type: "text",
          placeholder: "skip",
          optional: !(ratingKnown && areaKnown),
        });
      }
      return ask(undefined, asks);
    }

    const { rating, area } = ctx.data;
    const comment = ctx.data.comment && ctx.data.comment.toLowerCase() !== "skip" ? ctx.data.comment : "";
    // Filed without the document number: feedback stays anonymous, as at the touch kiosk.
    const filed = await fileApplication(ctx.service, { data: { rating, area, comment } });
    return done(resultMessage(feedbackResult(Number(rating), area, comment, filed)));
  },
  file: async ({ data }) => ({ data: triageData(await triageFeedback(data)) }),
  escalate: feedbackEscalation,
};
