// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * The multiserve `EngineServer`. `_generated/engines.ts` imports it as a namespace, so nothing here
 * is read while the import cycle with the Payload config (start handler → process registry →
 * settings → config → service hooks → this registry) is still evaluating.
 */

export { describeUnhealthy, isReachable } from './diagnosis'
export { getLogFile, getLogsDir, getModelsDir } from './paths'
export {
  cancelMultiserveStart as cancelStart,
  isMultiserveStarting as isStarting,
  startMultiserveModel as start,
} from './process-handler'
