// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from 'next'
import { PageHeading } from '@/components/shell/page-heading'
import { SystemMetrics } from './system-metrics'

export const metadata: Metadata = { title: 'System monitoring' }

export default function SystemMonitoringPage() {
  return (
    <div className="space-y-8">
      <PageHeading
        eyebrow="Hardware insights"
        title="System monitoring"
        description="Keep an eye on your local hardware. Readings update every 5 seconds."
      />
      <SystemMetrics />
    </div>
  )
}
