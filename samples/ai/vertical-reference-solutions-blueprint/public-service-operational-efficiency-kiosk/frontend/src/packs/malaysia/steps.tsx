// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import type { ComponentType } from "react";
import type { StepProps } from "@/services/shared/step-props";

// Client components — deliberately not on the CountryPack object, which
// server modules also import (see src/packs/types.ts).
const stepCtx = require.context("./services", true, /\/steps\/[a-z0-9-]+\.tsx$/);

const STEPS = new Map<string, ComponentType<StepProps>>(
  stepCtx.keys().map((key) => [
    key.slice(2).replace(/\.tsx$/, ""),
    stepCtx<{ default: ComponentType<StepProps> }>(key).default,
  ]),
);

export function packStep(dir: string, stepId: string): ComponentType<StepProps> | undefined {
  return STEPS.get(`${dir}/steps/${stepId}`);
}
