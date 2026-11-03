// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ArrowLeft, ArrowRight, Cpu, Database, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PhaseSetup } from '../../hooks/use-phase-setup'
import type { DeployPhase } from '../../lib/api'
import { formatModelChoice } from '../../lib/format'
import { PHASES, phaseStepTitle } from '../../lib/wizard'
import { ModelDeviceSelector } from '../model-device-selector'
import { PhaseBanner } from '../phase-banner'
import { StatCard } from '../stat-card'

interface StepModelProps {
  phase: DeployPhase
  setup: PhaseSetup
  onBack: () => void
  onContinue: () => void
}

/** Choosing the phase's model version and inference device. */
export function StepModel({
  phase,
  setup,
  onBack,
  onContinue,
}: StepModelProps) {
  const style = PHASES[phase]

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PhaseBanner
        phase={phase}
        title={phaseStepTitle(`${phase}-model`)}
        subtitle="Choose model version and hardware for inference"
      />

      <ModelDeviceSelector setup={setup} />

      <section
        aria-label={`${style.name} configuration`}
        className={cn('rounded-xl border p-4', style.surface)}
      >
        <p
          className={cn(
            'mb-3 text-xs font-semibold tracking-wider uppercase',
            style.text,
          )}
        >
          {style.name} Configuration
        </p>
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="Project"
            value={setup.project?.name ?? '—'}
            icon={FolderOpen}
            phase={phase}
          />
          <StatCard
            label="Model"
            value={formatModelChoice(setup.selectedModelId, setup.model)}
            icon={Database}
            phase={phase}
          />
          <StatCard
            label="Device"
            value={setup.selectedDevice}
            icon={Cpu}
            phase={phase}
          />
        </div>
      </section>

      <div className="flex gap-2">
        <Button variant="outline" className="gap-2" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back
        </Button>
        <Button className="flex-1 gap-2" onClick={onContinue}>
          Continue to Deploy
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  )
}
