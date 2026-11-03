// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** One "what it runs now" row at the top of the Runtime Settings sheet. */
export interface ConfigurePanelStatus {
  label: string
  value: string
}

/** The "CPU affinity" status row where pinning works (Linux, Windows) — `[]` elsewhere so it can be spread in. */
export function cpuAffinityStatusItem(
  canPinCpus: boolean,
  current: string,
): ConfigurePanelStatus[] {
  return canPinCpus
    ? [{ label: 'CPU affinity', value: current || 'all cores' }]
    : []
}
