// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import type { ComponentType } from "react";
import { packStep } from "@/packs/malaysia/steps";
import type { StepProps } from "./shared/step-props";
import type { ServiceDefinition, StepId } from "./types";

// Shared steps live in `shared/steps/<id>.tsx`; a pack overrides them with
// `steps/<id>.tsx` next to its `service.ts`. Register new packs' step modules
// statically below.
const sharedCtx = require.context("./shared/steps", false, /\/[a-z0-9-]+\.tsx$/);

const SHARED = new Map<string, ComponentType<StepProps>>(
  sharedCtx.keys().map((key) => [
    key.slice(2).replace(/\.tsx$/, ""),
    sharedCtx<{ default: ComponentType<StepProps> }>(key).default,
  ]),
);

const PACK_STEPS: Record<string, typeof packStep> = {
  malaysia: packStep,
};

const PACK_ID = process.env.NEXT_PUBLIC_KIOSK_PACK ?? "malaysia";
const activePackStep = PACK_STEPS[PACK_ID] ?? PACK_STEPS.malaysia;

export function resolveStep(
  service: ServiceDefinition | null,
  stepId: StepId,
): ComponentType<StepProps> | null {
  const custom = service?.dir ? activePackStep(service.dir, stepId) : undefined;
  return custom ?? SHARED.get(stepId) ?? null;
}
