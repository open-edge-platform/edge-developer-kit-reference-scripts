// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import fs from 'fs'
import path from 'path'
import { LOG_FILE_PATH } from '@/lib/constants'

/**
 * Appends a log message to a file in the logs directory.
 *
 * @param name - The name of the file to write to.
 * @param message - The message string to append.
 * @param type - The type of the log (e.g., 'INFO', 'ERROR').
 */
export const fileLogger = (
  name: string,
  message: string,
  type: string,
): void => {
  // Ensure the log directory exists
  if (!fs.existsSync(LOG_FILE_PATH)) {
    try {
      fs.mkdirSync(LOG_FILE_PATH, { recursive: true })
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        `[fileLogger] Failed to create log directory at ${LOG_FILE_PATH}:`,
        error,
      )
      return
    }
  }

  const timestamp = new Date().toISOString()
  const processName = path.parse(name).name
  const logEntry =
    JSON.stringify({
      timestamp,
      process: processName,
      pid: process.pid,
      type: type.toLowerCase() === 'info' ? 'out' : type.toLowerCase(),
      message: message.trim(),
    }) + '\n'
  const filePath = path.join(LOG_FILE_PATH, name)

  fs.appendFile(new URL(`file://${filePath}`), logEntry, (error) => {
    if (error) {
      // eslint-disable-next-line no-console
      console.error(
        `[fileLogger] Failed to write to log file ${filePath}:`,
        error,
      )
    }
  })
}
