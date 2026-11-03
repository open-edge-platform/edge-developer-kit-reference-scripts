// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Check, ChevronRight, type LucideIcon } from 'lucide-react'
import { TONES } from '@/components/common/tones'
import { cn } from '@/lib/utils'

export interface StepProgressStep<K extends string = string> {
  /** Stable key: what `current`, `completed` and `onStepClick` refer to. */
  key: K
  label: string
  /** Shown in place of the step's number until it is done. */
  icon?: LucideIcon
  /** A longer line about the step, shown as its tooltip. */
  description?: string
}

export interface StepProgressProps<K extends string> {
  steps: readonly StepProgressStep<K>[]
  current: K
  /** Steps that are done; by default every step before `current`. */
  completed?: ReadonlySet<K>
  /** Makes done steps and those before `current` buttons that go back to them. */
  onStepClick?: (key: K) => void
  /** Names the list for assistive technology, e.g. "Translation steps". */
  label: string
  className?: string
}

/** The samples' wizard step indicator: one pill per step, ticked once done. */
export function StepProgress<K extends string>({
  steps,
  current,
  completed,
  onStepClick,
  label,
  className,
}: StepProgressProps<K>) {
  const currentIndex = steps.findIndex((step) => step.key === current)

  return (
    <ol
      aria-label={label}
      className={cn('flex flex-wrap items-center gap-1 text-xs', className)}
    >
      {steps.map((step, i) => {
        const isCurrent = i === currentIndex
        const isDone =
          !isCurrent && (completed ? completed.has(step.key) : i < currentIndex)
        const canGoBack =
          onStepClick !== undefined &&
          !isCurrent &&
          (isDone || i < currentIndex)
        const Icon = step.icon
        const pillClass = cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium transition-colors',
          isCurrent
            ? TONES.primary.pill
            : isDone
              ? TONES.success.pill
              : 'border-border text-muted-foreground',
        )
        const content = (
          <>
            {isDone ? (
              <Check className="h-3 w-3" aria-hidden />
            ) : Icon ? (
              <Icon className="h-3 w-3" aria-hidden />
            ) : (
              <span className="tabular-nums" aria-hidden>
                {i + 1}
              </span>
            )}
            {step.label}
            {isDone && <span className="sr-only"> (done)</span>}
          </>
        )

        return (
          <li key={step.key} className="flex items-center gap-1">
            {canGoBack ? (
              <button
                type="button"
                title={step.description}
                onClick={() => onStepClick(step.key)}
                className={cn(
                  pillClass,
                  'hover:border-primary/40 focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]',
                )}
              >
                {content}
              </button>
            ) : (
              <span
                aria-current={isCurrent ? 'step' : undefined}
                title={step.description}
                className={pillClass}
              >
                {content}
              </span>
            )}
            {i < steps.length - 1 && (
              <ChevronRight
                className="text-muted-foreground/50 h-3.5 w-3.5"
                aria-hidden
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
