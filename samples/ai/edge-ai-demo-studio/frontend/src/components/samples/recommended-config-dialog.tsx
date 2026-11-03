// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader,
  Plus,
  RotateCcw,
  Wand2,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { shapedStatusDotClass } from '@/components/common/tones'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useSystemInfo } from '@/context/system-info-context'
import { useReturnFocus } from '@/hooks/use-return-focus'
import { plural } from '@/lib/browser/format'
import { STATE_LABEL } from '@/lib/instances/service-presentation'
import { cn } from '@/lib/utils'
import { resolveRecommendedConfigs } from '@/samples/types'
import type { Sample } from '@/samples/types'
import { DialogHeroHeader } from './dialog-hero-header'
import {
  type RecommendedApplyMode,
  type RecommendedApplyModes,
  type RecommendedApplyPlan,
  type RecommendedApplyResult,
  useApplyRecommendedConfig,
  useRecommendedConfigPlan,
} from './hooks/use-apply-recommended-config'

interface RecommendedConfigDialogProps {
  sample: Sample
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Review-before-apply of a sample's recommended settings, with one action labelled by its effect.
 * Outcomes are per service; a failed service can be retried without redoing the others.
 */
export function RecommendedConfigDialog({
  sample,
  open,
  onOpenChange,
}: RecommendedConfigDialogProps) {
  const { systemInfo } = useSystemInfo()
  // Update or new instance, per service that offers the choice.
  const [modes, setModes] = useState<RecommendedApplyModes>({})
  const plans = useRecommendedConfigPlan(
    resolveRecommendedConfigs(sample, systemInfo?.devices),
    modes,
  )
  const {
    mutate: apply,
    isPending,
    variables: inFlight,
  } = useApplyRecommendedConfig()

  // Kept per service, so a success stays visible when another service fails.
  const [results, setResults] = useState<
    Record<string, RecommendedApplyResult>
  >({})

  // Plans frozen at click time: after an apply the live plan for a row turns
  // into a no-op, so outcome totals read this list instead.
  const [applied, setApplied] = useState<RecommendedApplyPlan[] | null>(null)

  const returnFocus = useReturnFocus(open)

  const applicableLive = plans.filter((p) => !p.noop && !p.blocked)
  const appliedList = applied ?? []
  const failed = appliedList.filter(
    (p) => results[p.serviceId]?.status === 'failed',
  )
  const restarting = applicableLive.filter((p) => p.willRestart).length
  const creating = applicableLive.filter((p) => p.create).length
  const allDone =
    appliedList.length > 0 &&
    appliedList.every((p) => results[p.serviceId]?.status === 'done')
  // Distinguish "every service already matches" from "blocked".
  const nothingToDo = applied === null && applicableLive.length === 0
  const nothingBlocked = nothingToDo && plans.some((p) => p.blocked)

  const run = (targets: RecommendedApplyPlan[]) => {
    setApplied((prev) => {
      if (!prev) return targets
      const retried = new Set(targets.map((t) => t.serviceId))
      return [...prev.filter((p) => !retried.has(p.serviceId)), ...targets]
    })
    apply(targets, {
      onSuccess: (outcomes) =>
        setResults((prev) => ({
          ...prev,
          ...Object.fromEntries(outcomes.map((o) => [o.serviceId, o])),
        })),
    })
  }

  const handleClose = (next: boolean) => {
    if (!next) {
      setResults({})
      setApplied(null)
      setModes({})
    }
    onOpenChange(next)
  }

  // Every effect the click has goes in the label.
  const effects = [
    creating > 0 && `create ${plural(creating, 'instance')}`,
    restarting > 0 && `restart ${plural(restarting, 'service')}`,
  ].filter((e): e is string => Boolean(e))
  const actionLabel = isPending
    ? 'Applying…'
    : failed.length > 0
      ? `Retry ${plural(failed.length, 'failed service')}`
      : effects.length === 0
        ? 'Apply settings'
        : effects.length === 1
          ? `Apply settings and ${effects[0]}`
          : `Apply settings, ${effects[0]} and ${effects[1]}`

  const savedCount = appliedList.filter(
    (p) => results[p.serviceId]?.status === 'done',
  ).length
  const restartedCount = appliedList.filter(
    (p) => results[p.serviceId]?.status === 'done' && p.willRestart,
  ).length
  const createdCount = appliedList.filter(
    (p) => results[p.serviceId]?.status === 'done' && p.create,
  ).length

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-lg"
        onCloseAutoFocus={returnFocus}
      >
        <DialogHeroHeader
          icon={Wand2}
          title="Recommended settings"
          description="Current → proposed settings for each service this sample uses. Nothing changes until you apply: a service that is not set up yet gets an instance with these settings, and running services restart to pick the new settings up — or take them on a new instance, leaving the current one as it is."
        />

        {/* Keep long model names from widening the dialog: Radix lays the
            viewport's content out as a table, so force it to a block. */}
        <div className="min-w-0 px-6 pt-1 pb-5">
          <ScrollArea className="max-h-80 [&_[data-slot=scroll-area-viewport]>div]:block!">
            <ul className="space-y-2 py-2">
              {plans.map((plan) => (
                <PlanRow
                  key={plan.serviceId}
                  plan={plan}
                  appliedEntry={applied?.find(
                    (p) => p.serviceId === plan.serviceId,
                  )}
                  result={results[plan.serviceId]}
                  applying={
                    isPending &&
                    (inFlight?.some((p) => p.serviceId === plan.serviceId) ??
                      false)
                  }
                  locked={isPending}
                  onModeChange={(mode) =>
                    setModes((prev) => ({ ...prev, [plan.serviceId]: mode }))
                  }
                />
              ))}
            </ul>
          </ScrollArea>

          {allDone && (
            <p
              role="status"
              className="text-success mt-2 flex items-center gap-2 text-sm"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
              Settings saved for {plural(savedCount, 'service')}
              {createdCount > 0 &&
                ` · ${plural(createdCount, 'instance')} created`}
              {restartedCount > 0 &&
                ` · ${plural(restartedCount, 'service')} restarting; startup continues in the background`}
              .
            </p>
          )}
          {!allDone && failed.length > 0 && !isPending && (
            <p
              role="status"
              className="text-destructive mt-2 flex items-center gap-2 text-sm"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              {plural(failed.length, 'service')} could not be updated. Saved
              changes are kept; retry only what failed.
            </p>
          )}
          {nothingBlocked && (
            <p className="text-muted-foreground mt-2 text-sm">
              Nothing can be applied right now — see the notes above.
            </p>
          )}
        </div>

        <DialogFooter className="border-border/60 bg-muted/20 border-t px-6 py-4">
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={isPending}
          >
            {allDone ? 'Done' : 'Cancel'}
          </Button>
          {!allDone && (
            <Button
              onClick={() => run(failed.length > 0 ? failed : applicableLive)}
              disabled={isPending || nothingToDo}
              className="gap-2"
            >
              {isPending ? (
                <Loader className="h-4 w-4 animate-spin" aria-hidden />
              ) : failed.length > 0 ? (
                <RotateCcw className="h-4 w-4" aria-hidden />
              ) : (
                <Wand2 className="h-4 w-4" aria-hidden />
              )}
              {nothingBlocked
                ? 'Nothing can be applied'
                : nothingToDo
                  ? 'Already applied'
                  : actionLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PlanRow({
  plan,
  appliedEntry,
  result,
  applying,
  locked,
  onModeChange,
}: {
  plan: RecommendedApplyPlan
  appliedEntry: RecommendedApplyPlan | undefined
  result: RecommendedApplyResult | undefined
  applying: boolean
  /** An apply is in flight: the choice cannot change. */
  locked: boolean
  onModeChange: (mode: RecommendedApplyMode) => void
}) {
  const status = plan.target?.status ?? 'offline'
  // Once a result exists, report what was applied, not the refreshed live plan.
  const shown = result ? (appliedEntry ?? plan) : plan
  const { changes } = shown
  const instanceLabel = shown.label ?? shown.target?.label
  return (
    <li className="border-border/50 bg-background/60 rounded-xl border p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn('h-2 w-2 shrink-0', shapedStatusDotClass(status))}
              aria-hidden
            />
            <span className="text-foreground text-sm font-medium">
              {plan.name}
              {plan.target ? (
                <span className="sr-only">, {STATE_LABEL[status]}</span>
              ) : (
                plan.create && <span className="sr-only">, not set up</span>
              )}
            </span>
            {instanceLabel && instanceLabel !== plan.name && (
              <span className="text-muted-foreground text-xs">
                · {instanceLabel}
              </span>
            )}
            {plan.willRestart && !result && (
              <Badge tone="warning" className="text-xs">
                <RotateCcw className="h-3 w-3" aria-hidden />
                will restart
              </Badge>
            )}
            {plan.create && !result && (
              <Badge tone="primary" className="text-xs">
                <Plus className="h-3 w-3" aria-hidden />
                will be created
              </Badge>
            )}
          </div>
          {plan.choice && plan.target && !result && (
            <ModeChoice
              serviceName={plan.name}
              targetLabel={plan.target.label}
              mode={plan.choice.mode}
              createUnavailable={plan.choice.createUnavailable}
              disabled={locked}
              onChange={onModeChange}
            />
          )}
          {plan.blocked && !result ? (
            <p className="text-warning text-xs">{plan.blocked}</p>
          ) : plan.noop && !result ? (
            <p className="text-muted-foreground text-xs">
              Already using the recommended settings.
            </p>
          ) : (
            <>
              <dl className="space-y-0.5 text-xs">
                {changes.map((c) => (
                  <div
                    key={c.label}
                    className="flex flex-wrap items-center gap-1.5"
                  >
                    <dt className="text-muted-foreground w-20 shrink-0">
                      {c.label}
                    </dt>
                    <dd className="flex min-w-0 items-center gap-1.5 font-mono">
                      <span className="text-muted-foreground truncate">
                        {c.from ?? '—'}
                      </span>
                      <ArrowRight
                        className="text-muted-foreground/60 h-3 w-3 shrink-0"
                        aria-hidden
                      />
                      <span className="text-foreground truncate">{c.to}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              {plan.create && !plan.target && !result && (
                <p className="text-muted-foreground text-xs">
                  Not set up yet: an instance is created with these settings;
                  the rest follow the service&rsquo;s defaults.
                </p>
              )}
              {shown.create && shown.target && (
                <p className="text-muted-foreground text-xs">
                  {result
                    ? `Added with the other settings of “${shown.target.label}”, which is left as it is; this sample now uses the new instance.`
                    : `A new instance with the other settings of “${shown.target.label}”, which is left as it is; this sample switches to the new one.`}
                </p>
              )}
            </>
          )}
        </div>

        <div className="shrink-0 text-xs">
          {applying ? (
            <span className="text-muted-foreground inline-flex items-center gap-1">
              <Loader className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Applying
            </span>
          ) : result?.status === 'done' ? (
            <span className="text-success inline-flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              {(appliedEntry ?? plan).create ? 'Created' : 'Saved'}
            </span>
          ) : result?.status === 'failed' ? (
            <span className="text-destructive inline-flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5" aria-hidden />
              Failed
            </span>
          ) : null}
        </div>
      </div>
      {result?.status === 'failed' && result.error && (
        <p className="text-destructive mt-2 text-xs">{result.error}</p>
      )}
      {result?.warning && (
        <p className="text-warning mt-2 text-xs">{result.warning}</p>
      )}
    </li>
  )
}

/** Update the instance the sample uses, or take the settings on a new one. */
function ModeChoice({
  serviceName,
  targetLabel,
  mode,
  createUnavailable,
  disabled,
  onChange,
}: {
  serviceName: string
  targetLabel: string
  mode: RecommendedApplyMode
  createUnavailable: string | undefined
  disabled: boolean
  onChange: (mode: RecommendedApplyMode) => void
}) {
  const options: {
    value: RecommendedApplyMode
    label: string
    unavailable?: string
  }[] = [
    { value: 'update', label: `Update “${targetLabel}”` },
    {
      value: 'create',
      label: 'Create a new instance',
      unavailable: createUnavailable,
    },
  ]
  return (
    <div className="space-y-1 py-1">
      <div
        role="radiogroup"
        aria-label={`Where the ${serviceName} settings go`}
        className="grid grid-cols-2 gap-1.5"
      >
        {options.map((option) => {
          const selected = option.value === mode
          return (
            <Button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              size="sm"
              variant={selected ? 'default' : 'outline'}
              disabled={disabled || Boolean(option.unavailable)}
              className="h-auto min-h-7 min-w-0 py-1 text-xs whitespace-normal"
              onClick={() => {
                if (!selected) onChange(option.value)
              }}
            >
              {option.label}
            </Button>
          )
        })}
      </div>
      {createUnavailable && (
        <p className="text-muted-foreground text-xs">{createUnavailable}</p>
      )}
    </div>
  )
}
