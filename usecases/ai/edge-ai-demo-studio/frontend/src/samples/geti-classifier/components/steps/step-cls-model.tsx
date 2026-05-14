// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Cpu,
  Database,
  FolderOpen,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PhaseBanner } from '../phase-banner'
import { StatCard } from '../stat-card'
import { ModelDeviceSelector } from '../modal-device-selector'
import type { GetiModel, GetiProject } from '../../hooks'

interface StepClsModelProps {
  project: GetiProject | undefined
  models: GetiModel[]
  selectedModelId: string
  selectedDevice: string
  onModelChange: (id: string) => void
  onDeviceChange: (device: string) => void
  onSetupReset: () => void
  onBack: () => void
  onContinue: () => void
}

export function StepClsModel({
  project,
  models,
  selectedModelId,
  selectedDevice,
  onModelChange,
  onDeviceChange,
  onSetupReset,
  onBack,
  onContinue,
}: StepClsModelProps) {
  const selectedModel = models.find((m) => m.id === selectedModelId)

  const modelLabel =
    selectedModelId === 'latest'
      ? 'Latest Active'
      : selectedModel
        ? `${selectedModel.name} v${selectedModel.version ?? '?'}`
        : '—'

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PhaseBanner
        phase="cls"
        title="Classification Phase — Step 2 of 3"
        subtitle="Choose model version and hardware for inference"
        icon={BadgeCheck}
      />

      <ModelDeviceSelector
        phase="cls"
        models={models}
        selectedModelId={selectedModelId}
        onModelChange={onModelChange}
        selectedDevice={selectedDevice}
        onDeviceChange={onDeviceChange}
        onSetupReset={onSetupReset}
      />

      {/* Config summary */}
      <div className="rounded-xl border border-violet-200 bg-violet-50/30 p-4 dark:border-violet-800 dark:bg-violet-950/10">
        <p className="mb-3 text-xs font-semibold tracking-wider text-violet-600 uppercase dark:text-violet-400">
          Classification Configuration
        </p>
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="Project"
            value={project?.name ?? '—'}
            icon={FolderOpen}
            phase="cls"
          />
          <StatCard
            label="Model"
            value={modelLabel}
            icon={Database}
            phase="cls"
          />
          <StatCard
            label="Device"
            value={selectedDevice}
            icon={Cpu}
            phase="cls"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" className="gap-2" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          className="flex-1 gap-2 bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-700 hover:to-purple-700"
          onClick={onContinue}
        >
          Continue to Deploy
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
