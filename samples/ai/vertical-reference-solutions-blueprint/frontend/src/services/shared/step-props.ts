// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { KioskFlowActions, KioskFlowState } from "@/hooks/use-kiosk-flow";
import type { ServiceDefinition } from "../types";

/**
 * The single contract every step component (shared or service-specific)
 * receives. Custom steps typically read `state.data` and finish with
 * `actions.stepCompleted(stepId, data)`.
 */
export type StepProps = {
  service: ServiceDefinition | null;
  state: KioskFlowState;
  actions: KioskFlowActions;
};
