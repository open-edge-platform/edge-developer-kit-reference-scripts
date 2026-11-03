// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from 'next'
import { PageHeading } from '@/components/shell/page-heading'
import { SettingsForm } from './settings-form'

export const metadata: Metadata = { title: 'Settings' }

export default function SettingsPage() {
  return (
    <div className="max-w-2xl space-y-8">
      <PageHeading
        eyebrow="Workspace preferences"
        title="Settings"
        description="Make this workspace yours. Manage appearance, connections, and service preferences."
      />
      <SettingsForm />
    </div>
  )
}
