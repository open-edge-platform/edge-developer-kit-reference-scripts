// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ChevronRight } from 'lucide-react'
import { Fragment } from 'react'
import { cn } from '@/lib/utils'
import { StepProgress } from '../../common/components/step-progress'
import { PHASES, type Phase, STEPS, type StepKey, stepOf } from '../lib/wizard'

const PHASE_ORDER: Phase[] = ['connect', 'seg', 'cls']

/** Where the settings wizard is: the current phase, then its steps (done ones can be revisited). */
export function WizardProgress({
  current,
  completed,
  onStepClick,
}: {
  current: StepKey
  completed: ReadonlySet<StepKey>
  onStepClick: (step: StepKey) => void
}) {
  const currentPhase = stepOf(current).phase

  return (
    <div className="w-full space-y-3 px-1 py-3">
      <p className="flex items-center gap-2 text-xs">
        {PHASE_ORDER.map((phase, i) => {
          const { icon: Icon, name } = PHASES[phase]
          const isActive = phase === currentPhase
          return (
            <Fragment key={phase}>
              {i > 0 && (
                <ChevronRight
                  className="text-muted-foreground/50 h-3 w-3"
                  aria-hidden
                />
              )}
              <span
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold transition-all',
                  isActive
                    ? [PHASES[phase].surface, PHASES[phase].text]
                    : 'text-muted-foreground border-transparent',
                )}
              >
                <Icon className="h-3 w-3" aria-hidden />
                {name}
                {isActive && <span className="sr-only"> (current phase)</span>}
              </span>
            </Fragment>
          )
        })}
      </p>
      <StepProgress
        steps={STEPS}
        current={current}
        completed={completed}
        onStepClick={onStepClick}
        label="Setup steps"
      />
    </div>
  )
}
