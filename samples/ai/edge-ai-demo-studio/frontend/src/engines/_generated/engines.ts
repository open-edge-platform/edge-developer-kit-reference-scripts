// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY.
// Source of truth: scripts/generate-registries.mjs
// Run "npm run codegen" to regenerate.

import type { EngineServer } from '../types'

import * as multiserve from '../multiserve/server'

/**
 * Auto-discovered engine server modules, by engine id. Imported as
 * namespaces, so nothing is read from them while modules evaluate: a
 * start handler sits in an import cycle with the Payload config.
 */
export const engineServers: Record<string, EngineServer> = {
  multiserve: multiserve,
}
