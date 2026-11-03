// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ask, done } from "@/app/api/_lib/flows/plan";
import type { ChainSpec } from "@/app/api/_lib/flows/types";
import { hospitalAnswer } from "@/app/api/_lib/grounded";
import { answerResult } from "@/hospital/answers";
import { resultMessage } from "@/services/shared/result";
import { DISCOVERY_EXAMPLE, DISCOVERY_QUESTION, POPULAR_TOPICS } from "./discovery";

// Keep in sync with steps/application.tsx: both answer through hospitalAnswer.
export const chain: ChainSpec = {
  application: async (ctx) => {
    const query = ctx.data.topic ?? "";
    if (!query.trim()) {
      const examples = POPULAR_TOPICS.slice(0, 5).map((t) => t.question.toLowerCase()).join(", ");
      return ask(undefined, [
        {
          id: "topic",
          question: `${DISCOVERY_QUESTION} For example: ${examples}, or any department.`,
          type: "text",
          placeholder: DISCOVERY_EXAMPLE,
        },
      ]);
    }
    const answer = await hospitalAnswer(query);
    return done(resultMessage(answerResult(answer)), answer.destination ? { destination: answer.destination } : undefined);
  },
};
