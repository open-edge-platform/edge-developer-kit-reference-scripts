// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Console logging. Warnings and errors always print (a packaged build must still report problems);
 * `log`, `info` and `debug` only in development or with `ENABLE_LOGS=true`.
 */

const verbose =
  process.env.NODE_ENV !== 'production' || process.env.ENABLE_LOGS === 'true'

export const logger = {
  log: (...args: unknown[]): void => {
    if (verbose) console.log(`[LOG]:`, ...args)
  },

  info: (...args: unknown[]): void => {
    if (verbose) console.info(`[INFO]:`, ...args)
  },

  debug: (...args: unknown[]): void => {
    if (verbose) console.debug(`[DEBUG]:`, ...args)
  },

  warn: (...args: unknown[]): void => {
    console.warn(`[WARN]:`, ...args)
  },

  error: (...args: unknown[]): void => {
    console.error(`[ERROR]:`, ...args)
  },
}
