/* eslint-disable no-console */
// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Development-only logger utility
 * Logs will only appear when NODE_ENV is not 'production'
 */

const isDevelopment = process.env.NODE_ENV !== 'production'

/**
 * Logger that only outputs in development mode
 */
export const logger = {
  /**
   * Log informational messages (only in development)
   */
  log: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.log('[LOG]', ...args)
    }
  },

  /**
   * Log error messages (only in development)
   */
  error: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.error('[ERROR]', ...args)
    }
  },

  /**
   * Log warning messages (only in development)
   */
  warn: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.warn('[WARN]', ...args)
    }
  },

  /**
   * Log debug messages (only in development)
   */
  debug: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.debug('[DEBUG]', ...args)
    }
  },

  /**
   * Log info messages (only in development)
   */
  info: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.info('[INFO]', ...args)
    }
  },
}
