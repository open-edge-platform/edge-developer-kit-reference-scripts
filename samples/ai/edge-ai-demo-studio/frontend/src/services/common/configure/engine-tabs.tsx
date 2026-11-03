// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ArrowLeftRight } from 'lucide-react'
import { useId, useState } from 'react'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { SectionHeading } from '@/components/configure/config-section'
import { useConfigureSheetState } from '@/components/configure/configure-sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConfigureDraftHost } from '@/hooks/use-configure-draft'
import { useUpdateServiceEngine } from '@/hooks/use-service-config'
import {
  getExecutionModeOptions,
  resolveExecutionMode,
} from '@/services/execution'
import type {
  ExecutionMode,
  ExecutionModeOption,
  Service,
} from '@/services/types'
import { SegmentedChoiceSection } from './segmented-choice-section'

/**
 * Engine choice for services with several execution modes, first under Advanced settings. Each
 * engine has its own models and settings, so a switch is stored on confirm (not drafted) and the
 * sheet swaps to the new engine's panel; in a New-instance draft it sets the draft's engine.
 */
export function EngineTabs({ service }: { service: Service }) {
  const options = getExecutionModeOptions(service.execution)
  const draftHost = useConfigureDraftHost()

  if (options.length < 2) return null
  if (draftHost) {
    return (
      <SegmentedChoiceSection
        title="Engine"
        ariaLabel="Execution engine"
        testId="engine-tabs"
        optionTestId={(mode) => `engine-option-${mode}`}
        options={options.map((option) => ({
          value: option.mode,
          label: option.label,
          description: option.description,
        }))}
        value={draftHost.engine as ExecutionMode}
        onChange={(mode) => draftHost.setEngine(mode)}
        hint="Choose which engine this instance starts on; the rest of its settings follow the engine's own model list."
      />
    )
  }
  return (
    <EngineSwitch
      service={service}
      options={options}
      current={resolveExecutionMode(service.execution, service.engine)}
    />
  )
}

/** The engine an instance runs on, and a confirmed switch to another. */
function EngineSwitch({
  service,
  options,
  current,
}: {
  service: Service
  options: ExecutionModeOption[]
  current: ExecutionMode
}) {
  const headingId = useId()
  const { dirty, saving } = useConfigureSheetState()
  const { mutateAsync: switchEngine, isPending } = useUpdateServiceEngine()
  const [target, setTarget] = useState<ExecutionModeOption | null>(null)
  const label = service.label ?? service.name
  const currentLabel =
    options.find((o) => o.mode === current)?.label ?? 'the current engine'
  // The server restarts any instance that is not stopped (a failed one too).
  const restarts = service.status !== 'offline'

  const confirmSwitch = () => {
    if (!target || !service.dbId) return
    return switchEngine({
      serviceId: service.dbId,
      serviceType: service.id,
      engine: target.mode,
      engineLabel: target.label,
    })
  }

  return (
    <section
      aria-labelledby={headingId}
      className="border-border space-y-3 rounded-lg border p-3"
      data-testid="engine-tabs"
      data-engine={current}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionHeading id={headingId}>Engine</SectionHeading>
        <Badge tone="warning">Applies immediately</Badge>
      </div>
      <ul className="space-y-2">
        {options.map((option) => {
          const isCurrent = option.mode === current
          return (
            <li
              key={option.mode}
              data-testid={`engine-option-${option.mode}`}
              data-state={isCurrent ? 'active' : 'inactive'}
              className="border-border/70 flex items-center justify-between gap-3 rounded-md border p-2.5"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium">{option.label}</p>
                {option.description && (
                  <p className="text-muted-foreground text-xs">
                    {option.description}
                  </p>
                )}
              </div>
              {isCurrent ? (
                <Badge tone="muted" className="shrink-0">
                  Current
                </Badge>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5"
                  disabled={!service.dbId || isPending || saving}
                  onClick={() => setTarget(option)}
                  aria-label={`Switch to ${option.label}`}
                  data-testid={`engine-switch-${option.mode}`}
                >
                  <ArrowLeftRight aria-hidden="true" className="h-3.5 w-3.5" />
                  Switch
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      <p className="text-muted-foreground text-xs">
        Not part of Save or Cancel: a switch is stored as soon as you confirm it
        and resets the model to the engine&apos;s default
        {restarts ? `, and ${label} restarts on the new engine.` : '.'}
      </p>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null)
        }}
        title={`Switch ${label} to ${target?.label ?? 'another engine'}?`}
        description={
          <>
            This happens now, not when you save. The model resets to the
            engine&apos;s default
            {restarts
              ? ` and ${label} restarts on it; anything in progress is cut off.`
              : `; ${label} runs on it the next time it starts.`}
            {dirty && ' Your unsaved changes in this sheet are discarded.'}
          </>
        }
        confirmLabel={restarts ? 'Switch and restart' : 'Switch engine'}
        pendingLabel="Switching…"
        cancelLabel={`Keep ${currentLabel}`}
        confirmTestId="engine-switch-confirm"
        onConfirm={confirmSwitch}
      />
    </section>
  )
}
