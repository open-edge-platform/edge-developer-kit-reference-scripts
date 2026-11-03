// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ApplicationPlan, Ask, FlowRoute } from "./types";

/** Plan builders for the per-service flow planners (`chain.ts`). */
export const ask = (say: string | undefined, asks: Ask[]): ApplicationPlan => ({
  kind: "ask",
  say,
  asks,
});
export const halt = (reason: string): ApplicationPlan => ({ kind: "halt", reason });
export const done = (message: string, route?: FlowRoute): ApplicationPlan => ({ kind: "done", message, route });
export const READY: ApplicationPlan = { kind: "ready" };
