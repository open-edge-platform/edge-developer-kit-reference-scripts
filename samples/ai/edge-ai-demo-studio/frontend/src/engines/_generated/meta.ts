// THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY.
// Source of truth: scripts/generate-registries.mjs
// Run "npm run codegen" to regenerate.

import type { Engine } from '../types'

import { engine as multiserve } from '../multiserve/data'

/** Auto-discovered engine map (metadata-only). */
export const engines: Record<string, Engine> = {
  multiserve: multiserve,
}
