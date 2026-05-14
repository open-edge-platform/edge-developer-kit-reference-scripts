// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Cpu, Database, FolderOpen, Server } from 'lucide-react'
import type { GetiModel, GetiProject } from '../hooks'

interface DeploymentSummaryProps {
  phase: 'seg' | 'cls'
  host: string
  project: GetiProject | undefined
  selectedModelId: string
  model: GetiModel | undefined
  selectedDevice: string
}

const PHASE_STYLES = {
  seg: {
    headerGradient: 'bg-gradient-to-r from-blue-600 to-indigo-600',
    headerText: 'text-blue-100',
    border: 'border-blue-200 dark:border-blue-800',
    divider: 'divide-blue-100 dark:divide-blue-900',
    bg: 'bg-blue-50/30 dark:bg-blue-950/10',
  },
  cls: {
    headerGradient: 'bg-gradient-to-r from-violet-600 to-purple-600',
    headerText: 'text-violet-100',
    border: 'border-violet-200 dark:border-violet-800',
    divider: 'divide-violet-100 dark:divide-violet-900',
    bg: 'bg-violet-50/30 dark:bg-violet-950/10',
  },
} as const

export function DeploymentSummary({
  phase,
  host,
  project,
  selectedModelId,
  model,
  selectedDevice,
}: DeploymentSummaryProps) {
  const styles = PHASE_STYLES[phase]

  const modelLabel =
    selectedModelId === 'latest'
      ? 'Latest Active'
      : model
        ? `${model.name} v${model.version ?? '?'}`
        : '—'

  const rows = [
    {
      label: 'Server',
      value: host.replace('https://', '').replace('http://', ''),
      icon: Server,
    },
    { label: 'Project', value: project?.name ?? '—', icon: FolderOpen },
    { label: 'Model', value: modelLabel, icon: Database },
    { label: 'Device', value: selectedDevice, icon: Cpu },
  ]

  return (
    <div className={`overflow-hidden rounded-xl border ${styles.border}`}>
      <div className={`${styles.headerGradient} px-4 py-2.5`}>
        <p
          className={`text-xs font-semibold tracking-wider uppercase ${styles.headerText}`}
        >
          Deployment Configuration
        </p>
      </div>
      <div className={`divide-y ${styles.divider} ${styles.bg}`}>
        {rows.map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="flex items-center justify-between px-4 py-2.5"
          >
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Icon className="h-3.5 w-3.5" />
              {label}
            </div>
            <span className="text-sm font-medium">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
