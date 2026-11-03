// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ask, done } from "@/app/api/_lib/flows/plan";
import type { ChainSpec } from "@/app/api/_lib/flows/types";
import { healthAnswer } from "@/app/api/_lib/grounded";
import { answerResult } from "@/hospital/answers";
import { resultMessage } from "@/services/shared/result";
import { HEALTH_EXAMPLE, HEALTH_QUESTION, POPULAR_HEALTH_TOPICS } from "./answer";

// Keep in sync with steps/application.tsx: red flags, then the advice guard, then the guide.
export const chain: ChainSpec = {
  application: async (ctx) => {
    if (!ctx.data.question?.trim()) {
      const topics = POPULAR_HEALTH_TOPICS.map((t) => t.question.toLowerCase()).join(", ");
      return ask(undefined, [
        {
          id: "question",
          question: `${HEALTH_QUESTION} Common topics: ${topics}.`,
          type: "text",
          placeholder: HEALTH_EXAMPLE,
        },
      ]);
    }
    const answer = await healthAnswer(ctx.data.question);
    return done(resultMessage(answerResult(answer)), answer.destination ? { destination: answer.destination } : undefined);
  },
};
