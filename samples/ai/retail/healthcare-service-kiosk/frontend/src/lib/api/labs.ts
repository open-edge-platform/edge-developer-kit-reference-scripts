// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { LabExplanation } from "@/hospital/labs";
import { apiPost } from "./client";

export async function explainLabResults(documentNumber: string): Promise<LabExplanation | null> {
  return (await apiPost<{ explanation: LabExplanation | null }>("/labs/explain", { documentNumber })).explanation;
}

/** Email the patient their latest results; resolves to the masked address it went to. */
export async function emailLabResults(documentNumber: string): Promise<string> {
  return (await apiPost<{ sentTo: string }>("/labs/email", { documentNumber })).sentTo;
}
