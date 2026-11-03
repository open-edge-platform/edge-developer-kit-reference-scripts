// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { formatMoney } from "@/lib/format";
import { CURRENCY } from "@/app/api/_lib/registry";
import { ask, done } from "@/app/api/_lib/flows/plan";
import type { ChainSpec } from "@/app/api/_lib/flows/types";
import { LAB_TESTS, type LabTest } from "@/hospital/data";
import { resultMessage } from "@/services/shared/result";
import { labPriceResult } from "./lab-price";
import { matchTests } from "./lab-search";

const testAsk = (tests: LabTest[], question = "Which test would you like priced?") => ({
  id: "testId",
  question,
  type: "options" as const,
  options: tests.map((t) => ({ value: t.id, label: `${t.name} — ${formatMoney(t.price, CURRENCY)}` })),
});

export const chain: ChainSpec = {
  application: async (ctx) => {
    const said = ctx.data.testId ?? "";
    const { tests, aiAssisted } = said ? await matchTests(said) : { tests: [], aiAssisted: false };
    if (tests.length === 1) {
      const result = resultMessage(labPriceResult(tests[0], (amount) => formatMoney(amount, CURRENCY)));
      return done(aiAssisted ? `I took "${said}" to mean the ${tests[0].name}.\n${result}` : result);
    }
    if (tests.length > 1) {
      return ask(`A few tests match "${said}".`, [testAsk(tests, "Which of these do you mean?")]);
    }
    return ask(said ? `I couldn't find "${said}" in our test catalog.` : undefined, [testAsk(LAB_TESTS)]);
  },
};
