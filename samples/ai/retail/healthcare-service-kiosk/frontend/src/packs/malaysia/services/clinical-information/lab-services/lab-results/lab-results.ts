// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { HEALTH_DISCLAIMER } from "@/hospital/data";
import { DOCTOR_LINE, LAB_STATUS_LABEL, type LabExplanation } from "@/hospital/labs";
import type { LabResult } from "@/hospital/records";
import { resultMessage, type ServiceResult } from "@/services/shared/result";

/** With `explanation`, each row carries its plain-words sentence too, so the printed copy explains itself. */
export function labResultsResult(date: string, results: LabResult[], explanation?: LabExplanation): ServiceResult {
  return {
    title: "Lab Results",
    intro: `Results from ${date}.`,
    rows: results.map((r) => {
      const words = explanation?.items.find((item) => item.test === r.test)?.text;
      return { label: r.test, value: `${r.value} (${LAB_STATUS_LABEL[r.flag]})${words ? ` — ${words}` : ""}` };
    }),
    note: `${explanation?.closing ?? DOCTOR_LINE} ${HEALTH_DISCLAIMER}`,
  };
}

/** The chat reply: the values, then each explanation sentence and the closing line. */
export function labResultsMessage(date: string, results: LabResult[], explanation: LabExplanation): string {
  return [
    resultMessage({ ...labResultsResult(date, results), note: undefined }),
    "",
    explanation.aiAssisted ? "In plain words (AI-assisted):" : "In plain words:",
    ...explanation.items.map((item) => item.text),
    explanation.closing,
    HEALTH_DISCLAIMER,
  ].join("\n");
}
