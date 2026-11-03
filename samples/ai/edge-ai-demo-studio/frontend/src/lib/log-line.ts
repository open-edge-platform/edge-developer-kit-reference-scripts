// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** One JSON line of `logs/<type@id>.log`; `type` is the stream (`out`, `info`, `error`). */
export function formatLogLine(entry: {
  process: string
  pid: number | null | undefined
  type: string
  message: string
}): string {
  return `${JSON.stringify({
    timestamp: new Date().toISOString(),
    process: entry.process,
    pid: entry.pid || null,
    type: entry.type,
    message: entry.message.trim(),
  })}\n`
}
