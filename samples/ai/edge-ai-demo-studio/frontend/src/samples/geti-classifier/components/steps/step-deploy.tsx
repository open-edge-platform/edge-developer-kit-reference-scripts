// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  type LucideIcon,
  RefreshCw,
  Rocket,
  Tag,
} from 'lucide-react'
import { InlineNotice } from '@/components/common/inline-notice'
import { TONES } from '@/components/common/tones'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PhaseSetup } from '../../hooks/use-phase-setup'
import type { DeployPhase, SetupResult } from '../../lib/api'
import { formatModel } from '../../lib/format'
import { PHASES, phaseStepTitle } from '../../lib/wizard'
import { DeploymentSummary } from '../deployment-summary'
import { PhaseBanner } from '../phase-banner'
import { SetupProgress, setupStageLabel } from '../setup-progress'

interface StepDeployProps {
  phase: DeployPhase
  host: string
  setup: PhaseSetup
  onDeploy: () => void
  onBack: () => void
  /** Where to go once deployed. */
  next: { label: string; icon: LucideIcon; onClick: () => void }
}

/** Deploys the phase's model to the worker: the plan, the setup job's stages, then the result. */
export function StepDeploy({
  phase,
  host,
  setup,
  onDeploy,
  onBack,
  next,
}: StepDeployProps) {
  const style = PHASES[phase]
  const { project, deployed } = setup

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <PhaseBanner
        phase={phase}
        icon={Rocket}
        title={phaseStepTitle(`${phase}-deploy`)}
        subtitle={`Deploy the ${style.name.toLowerCase()} model to the inference worker`}
      />

      <DeploymentSummary
        phase={phase}
        host={host}
        project={project}
        selectedModelId={setup.selectedModelId}
        model={setup.model}
        selectedDevice={setup.selectedDevice}
      />

      {phase === 'cls' && project && project.labels.length > 0 && (
        <div
          className={cn(
            'flex items-start justify-between rounded-lg border px-4 py-2.5',
            style.surface,
          )}
        >
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Tag className="h-3.5 w-3.5" aria-hidden />
            Labels
          </div>
          <ul className="flex max-w-[60%] flex-wrap justify-end gap-1">
            {project.labels.map((label) => (
              <li key={label}>
                <Badge
                  variant="outline"
                  className={cn('text-[10px]', style.chip)}
                >
                  {label}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {setup.isDeploying && <SetupProgress job={setup.progress} />}

      {setup.deployError && (
        <InlineNotice tone="destructive" size="sm">
          <span className="font-medium">Deployment Failed.</span>{' '}
          {setup.deployError}
        </InlineNotice>
      )}

      {deployed ? (
        <DeploySuccess phase={phase} data={deployed} next={next} />
      ) : (
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back
          </Button>
          <Button
            className="flex-1 gap-2"
            size="lg"
            onClick={onDeploy}
            disabled={setup.isDeploying || !project}
            aria-busy={setup.isDeploying || undefined}
          >
            {setup.isDeploying ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
                {setupStageLabel(setup.progress)}
              </>
            ) : (
              <>
                <Rocket className="h-4 w-4" aria-hidden />
                Deploy {style.name} Worker
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}

function DeploySuccess({
  phase,
  data,
  next,
}: {
  phase: DeployPhase
  data: SetupResult
  next: StepDeployProps['next']
}) {
  const NextIcon = next.icon
  return (
    <div className="space-y-3">
      <div
        role="status"
        className={cn(
          'flex items-start gap-3 rounded-xl border p-4',
          TONES.success.surface,
        )}
      >
        <div
          className={cn(
            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full',
            TONES.success.iconBg,
          )}
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden />
        </div>
        <div>
          <p className="text-success-strong font-medium">
            {PHASES[phase].name} Worker Deployed!
          </p>
          <p className="text-success-strong mt-0.5 text-xs">
            {formatModel(data.model_name, data.model_version)}
            {' · '}
            {data.device}
            {' · '}
            {data.project_name}
          </p>
        </div>
      </div>

      <Button className="w-full gap-2" size="lg" onClick={next.onClick}>
        <NextIcon className="h-4 w-4" aria-hidden />
        {next.label}
        <ArrowRight className="ml-auto h-4 w-4" aria-hidden />
      </Button>
    </div>
  )
}
