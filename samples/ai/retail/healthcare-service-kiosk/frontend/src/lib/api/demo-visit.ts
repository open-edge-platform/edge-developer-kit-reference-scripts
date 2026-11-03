// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { apiGet, apiPost } from "./client";

export type { DemoVisit } from "@/app/api/_lib/demo-visit";
import type { DemoVisit } from "@/app/api/_lib/demo-visit";

export function getDemoVisit(citizen: number): Promise<DemoVisit> {
  return apiGet<DemoVisit>(`/staff/demo-visit?citizen=${citizen}`);
}

/** Clears the patient's last run and books today's visit if there is none; `done` says what changed. */
export function prepareDemoVisit(citizen: number): Promise<{ done: string[]; visit: DemoVisit }> {
  return apiPost<{ done: string[]; visit: DemoVisit }>("/staff/demo-visit", { citizen });
}
