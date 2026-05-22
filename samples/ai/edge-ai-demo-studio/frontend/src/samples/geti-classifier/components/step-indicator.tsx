// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  BadgeCheck,
  CheckCircle2,
  ChevronRight,
  Plug,
  Scissors,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PHASE_CONFIG, STEPS } from '../constants'

interface StepIndicatorProps {
  currentStep: number
  completedSteps: Set<number>
  onStepClick: (step: number) => void
}

export function StepIndicator({
  currentStep,
  completedSteps,
  onStepClick,
}: StepIndicatorProps) {
  return (
    <div className="w-full space-y-3 px-1 py-3">
      {/* ── Phase labels ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 text-xs">
        <PhaseLabel
          icon={Plug}
          label="Connect"
          isActive={currentStep === 1}
          activeClass="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
        />
        <ChevronRight className="text-muted-foreground/50 h-3 w-3" />
        <PhaseLabel
          icon={Scissors}
          label="Segmentation"
          isActive={currentStep >= 2 && currentStep <= 4}
          activeClass="bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
        />
        <ChevronRight className="text-muted-foreground/50 h-3 w-3" />
        <PhaseLabel
          icon={BadgeCheck}
          label="Classification"
          isActive={currentStep >= 5}
          activeClass="bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300"
        />
      </div>

      {/* ── Step circles ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-1">
        {STEPS.map((step, idx) => {
          const isCompleted = completedSteps.has(step.id)
          const isCurrent = currentStep === step.id
          const isClickable = isCompleted || step.id < currentStep
          const Icon = step.icon
          const phaseConfig = PHASE_CONFIG[step.phase]

          return (
            <div key={step.key} className="flex flex-1 items-center gap-1">
              {/* Circle + label */}
              <div className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={() => isClickable && onStepClick(step.id)}
                  disabled={!isClickable}
                  title={step.description}
                  className={cn(
                    'relative flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all duration-300',
                    isCompleted
                      ? 'border-green-500 bg-green-500 text-white shadow-sm shadow-green-200 hover:scale-105 hover:bg-green-600 dark:shadow-green-900/50'
                      : isCurrent
                        ? cn(
                            'scale-110 border-transparent text-white shadow-md',
                            `bg-gradient-to-br ${phaseConfig.gradient}`,
                          )
                        : 'border-muted bg-background text-muted-foreground/50 cursor-not-allowed',
                    isClickable && !isCurrent && 'cursor-pointer',
                  )}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <Icon className="h-3 w-3" />
                  )}

                  {/* Pulse ring on active step */}
                  {isCurrent && (
                    <span
                      className={cn(
                        'absolute -inset-1 animate-ping rounded-full opacity-20',
                        step.phase === 'seg'
                          ? 'bg-blue-500'
                          : step.phase === 'cls'
                            ? 'bg-violet-500'
                            : 'bg-slate-500',
                      )}
                    />
                  )}
                </button>

                <span
                  className={cn(
                    'text-center text-[9px] leading-tight font-semibold transition-colors',
                    isCurrent
                      ? step.phase === 'seg'
                        ? 'text-blue-600 dark:text-blue-400'
                        : step.phase === 'cls'
                          ? 'text-violet-600 dark:text-violet-400'
                          : 'text-slate-600 dark:text-slate-400'
                      : isCompleted
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-muted-foreground/50',
                  )}
                >
                  {step.label}
                </span>
              </div>

              {/* Connector line between steps */}
              {idx < STEPS.length - 1 && (
                <StepConnector
                  stepId={step.id}
                  phase={step.phase}
                  isCompleted={isCompleted}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Internal sub-components ───────────────────────────────────────────────────

function PhaseLabel({
  icon: Icon,
  label,
  isActive,
  activeClass,
}: {
  icon: React.ElementType
  label: string
  isActive: boolean
  activeClass: string
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold transition-all',
        isActive ? activeClass : 'text-muted-foreground',
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </div>
  )
}

function StepConnector({
  stepId,
  phase,
  isCompleted,
}: {
  stepId: number
  phase: 'connect' | 'seg' | 'cls'
  isCompleted: boolean
}) {
  // Steps 1 and 4 are phase-transition boundaries — use a dotted connector
  const isPhaseTransition = stepId === 1 || stepId === 4

  const completedColor =
    stepId === 1
      ? 'bg-blue-400'
      : stepId === 4
        ? 'bg-violet-400'
        : phase === 'seg'
          ? 'bg-blue-400'
          : 'bg-violet-400'

  if (isPhaseTransition) {
    return (
      <div className="mb-4 flex-1">
        <div className="flex items-center gap-0.5">
          <div
            className={cn(
              'h-0.5 flex-1 rounded-full transition-all duration-500',
              isCompleted ? completedColor : 'bg-muted',
            )}
          />
          <div className="bg-muted h-1 w-1 rounded-full" />
          <div
            className={cn(
              'h-0.5 flex-1 rounded-full transition-all duration-500',
              isCompleted ? completedColor : 'bg-muted',
            )}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="mb-4 flex-1">
      <div
        className={cn(
          'h-0.5 w-full rounded-full transition-all duration-500',
          isCompleted ? completedColor : 'bg-muted',
        )}
      />
    </div>
  )
}
