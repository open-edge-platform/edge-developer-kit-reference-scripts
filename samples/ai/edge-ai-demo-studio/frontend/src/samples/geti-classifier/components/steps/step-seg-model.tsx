// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  ArrowLeft,
  ArrowRight,
  Cpu,
  Database,
  FolderOpen,
  Scissors,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PhaseBanner } from '../phase-banner'
import { StatCard } from '../stat-card'
import { ModelDeviceSelector } from '../modal-device-selector'
import type { GetiModel, GetiProject } from '../../hooks'

interface StepSegModelProps {
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

export function StepSegModel({
  project,
  models,
  selectedModelId,
  selectedDevice,
  onModelChange,
  onDeviceChange,
  onSetupReset,
  onBack,
  onContinue,
}: StepSegModelProps) {
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
        phase="seg"
        title="Segmentation Phase — Step 2 of 3"
        subtitle="Choose model version and hardware for inference"
        icon={Scissors}
      />

      <ModelDeviceSelector
        phase="seg"
        models={models}
        selectedModelId={selectedModelId}
        onModelChange={onModelChange}
        selectedDevice={selectedDevice}
        onDeviceChange={onDeviceChange}
        onSetupReset={onSetupReset}
      />

      {/* Config summary */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/30 p-4 dark:border-blue-800 dark:bg-blue-950/10">
        <p className="mb-3 text-xs font-semibold tracking-wider text-blue-600 uppercase dark:text-blue-400">
          Segmentation Configuration
        </p>
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="Project"
            value={project?.name ?? '—'}
            icon={FolderOpen}
            phase="seg"
          />
          <StatCard
            label="Model"
            value={modelLabel}
            icon={Database}
            phase="seg"
          />
          <StatCard
            label="Device"
            value={selectedDevice}
            icon={Cpu}
            phase="seg"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" className="gap-2" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          className="flex-1 gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700"
          onClick={onContinue}
        >
          Continue to Deploy
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
