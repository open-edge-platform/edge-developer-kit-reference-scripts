// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  SuiteDeviceConfigurePanel,
  type SuiteModelDevice,
} from '@/services/common/configure/suite-device-configure-panel'
import type { Service } from '@/services/types'

/** HETERO runs detection and classification on their own devices (`data.ts` reads these keys). */
const PER_MODEL_DEVICES: SuiteModelDevice[] = [
  {
    key: 'detectDevice',
    label: 'Detection device (YOLO11n)',
    testId: 'cfg-detect-device-select',
  },
  {
    key: 'classifyDevice',
    label: 'Classification device (EfficientNet-B0)',
    testId: 'cfg-classify-device-select',
  },
]

export function LpConfigurePanel({ service }: { service: Service }) {
  return (
    <SuiteDeviceConfigurePanel
      service={service}
      modelName="loss-prevention"
      hint="Takes effect on next service start. HETERO lets detection and classification each run on their own device."
      perModelDevices={PER_MODEL_DEVICES}
    />
  )
}
