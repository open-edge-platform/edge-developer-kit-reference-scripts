// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import type { ComponentType } from "react";
import type { StepProps } from "@/services/shared/step-props";

/** What a filed case hands the patient — a queue ticket, a slip, a card — drawn under the chat's receipt. */
export type TakeawayProps = {
  /** Blank for a finished look-up, which files no case. */
  caseId: string;
  /** The filed case's status; blank for a look-up. */
  status: string;
  data: Record<string, string>;
  name: string;
  documentNumber: string;
};

// Client components — deliberately not on the CountryPack object, which
// server modules also import (see src/packs/types.ts).
const stepCtx = require.context("./services", true, /\/steps\/[a-z0-9-]+\.tsx$/);

const STEPS = new Map<string, ComponentType<never>>(
  stepCtx.keys().map((key) => [
    key.slice(2).replace(/\.tsx$/, ""),
    stepCtx<{ default: ComponentType<never> }>(key).default,
  ]),
);

export function packStep(dir: string, stepId: string): ComponentType<StepProps> | undefined {
  return STEPS.get(`${dir}/steps/${stepId}`) as ComponentType<StepProps> | undefined;
}

/** `steps/takeaway.tsx` is not a step of the flow: the chat draws it under a filed case's receipt. */
export function packTakeaway(dir: string): ComponentType<TakeawayProps> | undefined {
  return STEPS.get(`${dir}/steps/takeaway`) as ComponentType<TakeawayProps> | undefined;
}
