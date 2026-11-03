// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY.
// Source of truth: scripts/generate-registries.mjs
// Run "npm run codegen" to regenerate.

import type { ComponentType } from 'react'
import type { EngineConfigurePanelProps } from '../types'

import { MultiserveConfigurePanel } from '../multiserve/components/configure-panel'

/** Each engine's Runtime Settings panel, by engine id. */
export const engineConfigurePanels: Partial<
  Record<string, ComponentType<EngineConfigurePanelProps>>
> = {
  multiserve: MultiserveConfigurePanel,
}
