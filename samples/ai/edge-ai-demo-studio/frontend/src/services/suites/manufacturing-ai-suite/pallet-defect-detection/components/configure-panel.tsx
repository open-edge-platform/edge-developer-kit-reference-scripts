// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { SuiteDeviceConfigurePanel } from '@/services/common/configure/suite-device-configure-panel'
import type { Service } from '@/services/types'

export function PddConfigurePanel({ service }: { service: Service }) {
  return (
    <SuiteDeviceConfigurePanel
      service={service}
      modelName="pallet-defect-detection"
      testId="pdd-cfg-device"
      hint="Takes effect on next service start. Selects the DL Streamer pipeline (CPU/GPU/NPU) used for pallet defect detection."
    />
  )
}
