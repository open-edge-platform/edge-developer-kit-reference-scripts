// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { explainLabResults } from "@/app/api/_lib/lab-explain";
import { done } from "@/app/api/_lib/flows/plan";
import type { ChainSpec } from "@/app/api/_lib/flows/types";
import { templateExplanation } from "@/hospital/labs";
import { patientRecord } from "@/hospital/records";
import { labResultsMessage } from "./lab-results";

// Keep in sync with steps/application.tsx: same record, same explanations.
export const chain: ChainSpec = {
  application: async (ctx) => {
    const record = patientRecord(ctx.documentNumber);
    if (!record.labResults) {
      return done("There are no lab results on your record yet.");
    }
    const { date, results } = record.labResults;
    const explanation = (await explainLabResults(ctx.documentNumber)) ?? templateExplanation(results);
    return done(labResultsMessage(date, results, explanation));
  },
};
