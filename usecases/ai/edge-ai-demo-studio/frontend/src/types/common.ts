// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export type OS = 'windows' | 'linux'
export type Device = 'cpu' | 'gpu' | 'xpu' | 'npu'

/** Log entry returned by the multiserve worker API (`/v1/logs`). */
export interface ApiLogEntry {
  timestamp: string
  message: string
  level?: string
}

/** Response shape returned by the multiserve worker log endpoint. */
export interface ApiLogResponse {
  logs: ApiLogEntry[]
  offset: number
  timestamp: string | null
}
