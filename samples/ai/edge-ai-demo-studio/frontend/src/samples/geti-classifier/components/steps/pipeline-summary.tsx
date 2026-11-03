// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ArrowRight, CheckCircle2, Rocket, Sparkles } from 'lucide-react'
import { TONES } from '@/components/common/tones'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { DeployPhase, SetupResult } from '../../lib/api'
import { formatModel } from '../../lib/format'
import { PHASES } from '../../lib/wizard'

/** The wizard's end: both workers deployed, and the way to start classifying. */
export function PipelineSummary({
  segData,
  clsData,
  onStart,
}: {
  segData: SetupResult
  clsData: SetupResult
  onStart: () => void
}) {
  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div
        role="status"
        className={cn('rounded-2xl border p-6', TONES.success.surface)}
      >
        <div className="mb-3 flex items-center gap-2">
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-xl',
              TONES.success.iconBg,
            )}
          >
            <Sparkles className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <p className="text-success-strong text-sm font-semibold">
              Pipeline Ready
            </p>
            <p className="text-muted-foreground text-xs">
              Both workers deployed successfully
            </p>
          </div>
        </div>
        <h3 className="text-xl font-bold">Success</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Segmentation + Classification Pipeline is ready
        </p>
      </div>

      <section
        aria-labelledby="geti-active-pipeline"
        className="bg-muted/20 space-y-3 rounded-xl border p-4"
      >
        <h4
          id="geti-active-pipeline"
          className="text-muted-foreground text-xs font-semibold tracking-wider uppercase"
        >
          Active Pipeline
        </h4>

        <WorkerCard phase="seg" data={segData} showConnector />

        <div className="flex items-center gap-3 pl-4">
          <ArrowRight
            className="text-muted-foreground h-3.5 w-3.5"
            aria-hidden
          />
          <span className="text-muted-foreground text-xs">
            Segmented regions passed to classifier
          </span>
        </div>

        <WorkerCard phase="cls" data={clsData} showConnector={false} />
      </section>

      <Button className="w-full gap-2" size="lg" onClick={onStart}>
        <Rocket className="h-4 w-4" aria-hidden />
        Start Classifying Images
        <ArrowRight className="ml-auto h-4 w-4" aria-hidden />
      </Button>
    </div>
  )
}

function WorkerCard({
  phase,
  data,
  showConnector,
}: {
  phase: DeployPhase
  data: SetupResult
  showConnector: boolean
}) {
  const style = PHASES[phase]
  const Icon = style.icon

  return (
    <div className="flex items-stretch gap-3">
      <div className="flex flex-col items-center gap-1">
        <div
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg shadow-sm',
            style.solid,
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        {showConnector && <div className="bg-border w-0.5 flex-1" />}
      </div>

      <div className={cn('flex-1 rounded-lg border p-3', style.surface)}>
        <div className="mb-1 flex items-center justify-between">
          <span
            className={cn(
              'text-xs font-semibold tracking-wider uppercase',
              style.text,
            )}
          >
            {style.name} Worker
          </span>
          <Badge tone="success" className="text-[10px]">
            <CheckCircle2 aria-hidden />
            Active
          </Badge>
        </div>
        <p className="text-sm font-medium">{data.project_name}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {formatModel(data.model_name, data.model_version)}
          {' · '}
          {data.device}
        </p>
        {phase === 'cls' && data.labels.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1" aria-label="Labels">
            {data.labels.map((label) => (
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
        )}
      </div>
    </div>
  )
}
