// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable no-console */

const isDevelopment =
  process.env.NODE_ENV !== 'production' || process.env.ENABLE_LOGS === 'true'

type NodeModuleLoader = (id: string) => {
  existsSync?: (path: string) => boolean
  mkdirSync?: (path: string, options?: { recursive?: boolean }) => void
  appendFile?: (
    path: URL,
    data: string,
    callback: (error: Error | null) => void,
  ) => void
  join?: (...paths: string[]) => string
  parse?: (path: string) => { name: string }
}

const getNodeLoader = (): NodeModuleLoader | null => {
  if (typeof window !== 'undefined') {
    return null
  }

  try {
    return Function('return require')() as NodeModuleLoader
  } catch {
    return null
  }
}

const getLogsDir = (join: (...paths: string[]) => string): string => {
  return join(process.cwd(), '..', 'logs')
}

const fileLogger = (name: string, message: string, type: string): void => {
  const nodeRequire = getNodeLoader()
  if (!nodeRequire) {
    return
  }

  const fs = nodeRequire('node:fs')
  const path = nodeRequire('node:path')
  const join = path.join
  const parse = path.parse

  if (!fs.existsSync || !fs.mkdirSync || !fs.appendFile || !join || !parse) {
    return
  }

  const logsDir = getLogsDir(join)

  if (!fs.existsSync(logsDir)) {
    try {
      fs.mkdirSync(logsDir, { recursive: true })
    } catch (error) {
      console.error(
        `[fileLogger] Failed to create log directory at ${logsDir}:`,
        error,
      )
      return
    }
  }

  const timestamp = new Date().toISOString()
  const processName = parse(name).name
  const fileType = type.toLowerCase() === 'info' ? 'out' : type.toLowerCase()
  const logEntry = `${JSON.stringify({
    timestamp,
    process: processName,
    pid: process.pid,
    type: fileType,
    message: message.trim(),
  })}\n`
  const filePath = join(logsDir, name)

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
  log: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.log(`[LOG]:`, ...args)
    }
  },

  error: (...args: unknown[]): void => {
    console.error(`[ERROR]:`, ...args)
  },

  warn: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.warn(`[WARN]:`, ...args)
    }
  },

  debug: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.debug(`[DEBUG]:`, ...args)
    }
  },

  info: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.info(`[INFO]:`, ...args)
    }
  },
  file: (content: string, type: string, name: string): void => {
    fileLogger(name, content, type)
  },
}
