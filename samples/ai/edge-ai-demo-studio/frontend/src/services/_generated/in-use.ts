// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY.
// Source of truth: scripts/generate-registries.mjs
// Run "npm run codegen" to regenerate.

import { useInUse as useMcpInUse } from '../mcp/in-use'

/** Ids of the built-in services in use (`in-use.ts`), which the sidebar lists. */
export function useServicesInUse(): string[] {
  const mcp = useMcpInUse()
  return [...(mcp ? ['mcp'] : [])]
}
