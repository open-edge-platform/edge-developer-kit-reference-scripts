// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { formatMoney } from "@/lib/format";
import { CURRENCY } from "@/app/api/_lib/registry";
import { ask, done } from "@/app/api/_lib/flows/plan";
import type { ChainSpec } from "@/app/api/_lib/flows/types";
import { PAYERS, PROCEDURES } from "@/hospital/data";
import { resultMessage } from "@/services/shared/result";
import { estimateResult, findProcedure } from "./estimate";

export const chain: ChainSpec = {
  application: (ctx) => {
    const procedure = findProcedure(ctx.data.procedureId ?? "");
    if (procedure) ctx.data.procedureId = procedure.id;
    if (!procedure) {
      return ask(ctx.data.procedureId ? "I couldn't find that procedure in our catalog." : undefined, [
        {
          id: "procedureId",
          question: "Which procedure would you like estimated?",
          type: "options",
          options: PROCEDURES.map((p) => ({ value: p.id, label: p.name })),
        },
      ]);
    }
    if (ctx.data.payer !== "self" && !PAYERS.some((p) => p.id === ctx.data.payer)) {
      return ask(`${procedure.name} — your insurer changes what you pay.`, [
        {
          id: "payer",
          question: "How will you be paying?",
          type: "options",
          options: [{ value: "self", label: "Self-pay" }, ...PAYERS.map((p) => ({ value: p.id, label: p.name }))],
        },
      ]);
    }
    return done(resultMessage(estimateResult(procedure, ctx.data.payer, (amount) => formatMoney(amount, CURRENCY))));
  },
};
