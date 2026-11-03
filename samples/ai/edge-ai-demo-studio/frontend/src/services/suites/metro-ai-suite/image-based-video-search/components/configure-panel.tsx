// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { SuiteDeviceConfigurePanel } from '@/services/common/configure/suite-device-configure-panel'
import type { Service } from '@/services/types'

export function IbvsConfigurePanel({ service }: { service: Service }) {
  return (
    <SuiteDeviceConfigurePanel
      service={service}
      modelName="image-based-video-search"
      testId="ibvs-cfg-device"
      hint="Takes effect on next service start. Configures the YOLOv11s and ResNet-50 detection pipeline."
    />
  )
}
