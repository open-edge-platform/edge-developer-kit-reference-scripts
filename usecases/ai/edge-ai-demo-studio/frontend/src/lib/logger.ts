// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable no-console */

import fs from 'node:fs'
import path from 'node:path'
import { LOGS_DIR } from './constants'

/**
 * Development-only logger utility
 * Logs will only appear when NODE_ENV is not 'production'
 */

const isDevelopment =
  process.env.NODE_ENV !== 'production' || process.env.ENABLE_LOGS === 'true'

/**
 * Logger that only outputs in development mode
 */
const fileLogger = (name: string, message: string, type: string): void => {
  // Ensure the log directory exists
  if (!fs.existsSync(LOGS_DIR)) {
    try {
      fs.mkdirSync(LOGS_DIR, { recursive: true })
    } catch (error) {
      console.error(
        `[fileLogger] Failed to create log directory at ${LOGS_DIR}:`,
        error,
      )
      return
    }
  }

  const timestamp = new Date().toISOString()
  const processName = path.parse(name).name
  const fileType = type.toLowerCase() === 'info' ? 'out' : type.toLowerCase()
  const logEntry = `${JSON.stringify({
    timestamp,
    process: processName,
    pid: process.pid,
    type: fileType,
    message: message.trim(),
  })}\n`
  const filePath = path.join(LOGS_DIR, name)

  fs.appendFile(new URL(`file://${filePath}`), logEntry, (error) => {
    if (error) {
      console.error(
        `[fileLogger] Failed to write to log file ${filePath}:`,
        error,
      )
    }
  })
}

export const logger = {
  /**
   * Log informational messages (only in development)
   */
  log: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.log(`[LOG]:`, ...args)
    }
  },

  /**
   * Log error messages (only in development)
   */
  error: (...args: unknown[]): void => {
    console.error(`[ERROR]:`, ...args)
  },

  /**
   * Log warning messages (only in development)
   */
  warn: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.warn(`[WARN]:`, ...args)
    }
  },

  /**
   * Log debug messages (only in development)
   */
  debug: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.debug(`[DEBUG]:`, ...args)
    }
  },

  /**
   * Log info messages (only in development)
   */
  info: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.info(`[INFO]:`, ...args)
    }
  },
  file: (content: string, type: string, name: string): void => {
    fileLogger(name, content, type)
  },
}
