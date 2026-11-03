// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { GroundedAnswer } from "@/hospital/answers";
import { apiPost } from "./client";

export function askHospital(question: string): Promise<GroundedAnswer> {
  return apiPost<GroundedAnswer>("/answers/hospital", { question });
}

export function askHealth(question: string): Promise<GroundedAnswer> {
  return apiPost<GroundedAnswer>("/answers/health", { question });
}
