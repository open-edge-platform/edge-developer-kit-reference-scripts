// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Cpu, Database, FolderOpen, Server } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DeployPhase, GetiModel, GetiProject } from '../lib/api'
import { formatModelChoice, hostLabel } from '../lib/format'
import { PHASES } from '../lib/wizard'

interface DeploymentSummaryProps {
  phase: DeployPhase
  host: string
  project: GetiProject | undefined
  selectedModelId: string
  model: GetiModel | undefined
  selectedDevice: string
}

/** What a deploy is about to set up: server, project, model and device. */
export function DeploymentSummary({
  phase,
  host,
  project,
  selectedModelId,
  model,
  selectedDevice,
}: DeploymentSummaryProps) {
  const style = PHASES[phase]
  const rows = [
    { label: 'Server', value: hostLabel(host), icon: Server },
    { label: 'Project', value: project?.name ?? '—', icon: FolderOpen },
    {
      label: 'Model',
      value: formatModelChoice(selectedModelId, model),
      icon: Database,
    },
    { label: 'Device', value: selectedDevice, icon: Cpu },
  ]

  return (
    <div className={cn('overflow-hidden rounded-xl border', style.surface)}>
      <p
        className={cn(
          'px-4 py-2.5 text-xs font-semibold tracking-wider uppercase',
          style.solid,
        )}
      >
        Deployment Configuration
      </p>
      <dl className={cn('divide-y', style.divide)}>
        {rows.map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="flex items-center justify-between px-4 py-2.5"
          >
            <dt className="text-muted-foreground flex items-center gap-2 text-sm">
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {label}
            </dt>
            <dd className="text-sm font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
