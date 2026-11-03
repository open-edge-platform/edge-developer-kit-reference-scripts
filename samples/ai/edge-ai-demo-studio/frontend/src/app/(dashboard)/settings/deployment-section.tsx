// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { FileJson } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { DeploymentDialog } from './deployment-dialog'
import { SettingsSection } from './settings-section'

/** Saves the current services as a deployment.json preset (its own dialog). */
export function DeploymentSection() {
  const [open, setOpen] = useState(false)
  return (
    <SettingsSection
      title="Deployment"
      description="Reuse the current service setup on another machine or after a reinstall."
      stagger={4}
    >
      <div className="space-y-2">
        <p className="text-sm leading-none font-medium">Current deployment</p>
        <div>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setOpen(true)}
          >
            <FileJson aria-hidden="true" className="h-4 w-4" />
            Save current deployment…
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Snapshots every service&apos;s instances — engine, model, device and
          metadata — into a <code>deployment.json</code> preset, and marks the
          running ones to start automatically. Saved on this machine, the file
          is applied every time the app starts: instances and services that are
          not in it are removed. You can review all of this, or download the
          file instead, before anything is written.
        </p>
      </div>
      <DeploymentDialog open={open} onOpenChange={setOpen} />
    </SettingsSection>
  )
}
