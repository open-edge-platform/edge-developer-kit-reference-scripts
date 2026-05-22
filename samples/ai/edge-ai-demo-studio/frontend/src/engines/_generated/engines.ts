// THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY.
// Source of truth: scripts/generate-registries.mjs
// Run "npm run codegen" to regenerate.

import type { BasePayload } from 'payload'
import type { Service } from '@/payload-types'

import { engines as enginesMeta } from './meta'

import { startMultiserveModel } from '../multiserve/process-handler'

export const engines = enginesMeta

/** Engine start handler signature. */
export type EngineStartHandler = (
  service: Service,
  payload: BasePayload,
) => Promise<void>

/** Maps engine identifiers to their start handlers. */
export const engineHandlers: Record<string, EngineStartHandler> = {
  multiserve: startMultiserveModel,
}
