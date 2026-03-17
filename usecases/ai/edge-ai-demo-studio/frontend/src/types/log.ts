// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export interface LogEntry {
  timestamp: string
  message: string
  type: 'error' | 'out'
}

export interface LogResponse {
  logs: LogEntry[]
  offset: number
  timestamp: string | null
}
