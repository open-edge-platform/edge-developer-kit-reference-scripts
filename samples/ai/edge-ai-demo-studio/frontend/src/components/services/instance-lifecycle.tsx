// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader, Power, RotateCcw, Square } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { STATUS_TONE, TONES, type Tone } from '@/components/common/tones'
import { Button } from '@/components/ui/button'
import { useExternalStore } from '@/hooks/use-external-store'
import type { ServiceAction } from '@/hooks/use-services'
import { actionFor, useServiceToggle } from '@/hooks/use-service-toggle'
import { createExternalStore } from '@/lib/browser/external-store'
import { STATE_LABEL } from '@/lib/instances/service-presentation'
import { STARTUP_STAGE_LABEL } from '@/lib/instances/startup-presentation'
import { cn } from '@/lib/utils'
import { useSessionBusyInstances } from '@/services/common/demo/session-store'
import type { ServiceInstance, ServiceStatus } from '@/services/types'

/** An instance key (or a service type, resolving to its primary instance) and its label. */
type LifecycleTarget = Pick<ServiceInstance, 'instanceKey' | 'label'>

type Interruption = 'stop' | 'restart' | 'delete'

const INTERRUPTION_WORDS: Record<
  Interruption,
  { verb: string; gerund: string }
> = {
  stop: { verb: 'Stop', gerund: 'Stopping' },
  restart: { verb: 'Restart', gerund: 'Restarting' },
  delete: { verb: 'Delete', gerund: 'Deleting' },
}

const NONE_BUSY: ReadonlySet<string> = new Set()

/** Instances whose demo has work in flight on the shown service page, for guards outside it. */
const pageBusyInstances = createExternalStore(NONE_BUSY)

/** Render once inside the service page's `DemoSessionProvider` to share its busy instances. */
export function ShareSessionBusy() {
  const busy = useSessionBusyInstances()
  useEffect(() => {
    pageBusyInstances.set(busy)
    return () => pageBusyInstances.set(NONE_BUSY)
  }, [busy])
  return null
}

/**
 * Asks before stopping, restarting or deleting instances whose demo still has work in flight.
 * Only the shown service page knows (shared via `ShareSessionBusy`); elsewhere nothing is asked.
 */
export function useInterruptionGuard(): {
  guard: (
    instances: readonly LifecycleTarget[],
    action: Interruption,
    run: () => void,
  ) => void
  dialog: ReactNode
} {
  const sessionBusy = useSessionBusyInstances()
  const pageBusy = useExternalStore(pageBusyInstances, NONE_BUSY)
  // The last request stays after the dialog closes, so its words do not
  // blank out while it fades.
  const [pending, setPending] = useState<{
    names: string[]
    action: Interruption
    run: () => void
  } | null>(null)
  const [open, setOpen] = useState(false)

  const guard = (
    instances: readonly LifecycleTarget[],
    action: Interruption,
    run: () => void,
  ) => {
    const working = instances.filter(
      (i) => sessionBusy.has(i.instanceKey) || pageBusy.has(i.instanceKey),
    )
    if (working.length === 0) {
      run()
      return
    }
    setPending({ names: working.map((i) => i.label), action, run })
    setOpen(true)
  }

  const { verb, gerund } = pending
    ? INTERRUPTION_WORDS[pending.action]
    : { verb: '', gerund: '' }
  const names = pending?.names.map((n) => `“${n}”`).join(', ') ?? ''
  const one = pending?.names.length === 1

  const dialog = (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      variant="destructive"
      title={`${verb} ${one ? names : `${pending?.names.length} instances`} while ${one ? 'it is' : 'they are'} working?`}
      description={`${names} ${one ? 'is' : 'are'} still producing a result in the demo. ${gerund} cuts that off.`}
      cancelLabel="Keep working"
      confirmLabel={`${verb} anyway`}
      onConfirm={() => pending?.run()}
      data-testid="interruption-dialog"
    />
  )

  return { guard, dialog }
}

const PENDING_LABEL: Record<ServiceAction, string> = {
  start: 'Starting…',
  stop: 'Stopping…',
  restart: 'Restarting…',
}

/** A request just sent wins over the last polled status, until the runtime confirms. */
function lifecycleState(
  status: ServiceStatus,
  pendingAction: ServiceAction | null,
): { label: string; tone: Tone } {
  if (pendingAction) {
    return {
      label: PENDING_LABEL[pendingAction],
      tone: pendingAction === 'stop' ? 'muted' : 'warning',
    }
  }
  return { label: STATE_LABEL[status], tone: STATUS_TONE[status] }
}

/** Status dot and label for one instance; while starting, the reported startup stage if any. */
export function InstanceStatusLabel({
  instance,
  className,
  testId,
  appearance = 'text',
}: {
  instance: ServiceInstance
  className?: string
  testId?: string
  appearance?: 'text' | 'badge'
}) {
  const { status, pendingAction } = useServiceToggle(instance.instanceKey)
  const { label, tone } = lifecycleState(status, pendingAction)
  const stage =
    !pendingAction && status === 'starting'
      ? instance.startup?.stage
      : undefined
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap',
        appearance === 'badge'
          ? ['h-7 rounded-full border px-2.5', TONES[tone].pill]
          : TONES[tone].text,
        className,
      )}
      data-testid={testId}
      data-status={pendingAction ? `${pendingAction}-pending` : status}
      data-stage={stage}
    >
      {pendingAction ? (
        <Loader aria-hidden="true" className="h-3 w-3 animate-spin" />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            TONES[tone].dot,
            tone === 'warning' && 'animate-pulse',
          )}
        />
      )}
      {stage ? (
        <>
          <span className="sr-only">{label}: </span>
          {STARTUP_STAGE_LABEL[stage]}
        </>
      ) : (
        label
      )}
    </span>
  )
}

/** `bar`: control bar; `row`: instance manager (tinted); `sample`: sample checklist row. */
type LifecycleButtonVariant = 'bar' | 'row' | 'sample'

/** A stop is drawn in the destructive tone, softly: it ends work, but undoes nothing. */
const STOP_CLASS =
  'border-destructive/25 bg-destructive/10 text-destructive hover:border-destructive/40 hover:bg-destructive/15 hover:text-destructive dark:border-destructive/30 dark:bg-destructive/15 dark:hover:bg-destructive/25'

const ROW_START_CLASS =
  'border-primary/25 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary'

function buttonLabel(
  variant: LifecycleButtonVariant,
  action: ServiceAction,
  pendingAction: ServiceAction | null,
): string {
  if (pendingAction) return PENDING_LABEL[pendingAction]
  if (action === 'restart') return 'Retry'
  const verb = action === 'stop' ? 'Stop' : 'Start'
  return variant === 'bar' ? `${verb} service` : verb
}

function buttonName(
  variant: LifecycleButtonVariant,
  action: ServiceAction,
  label: string,
  pending: boolean,
  target: string,
): string {
  if (pending || variant === 'sample') return `${label} ${target}`
  if (action === 'restart') return `Retry starting ${target}`
  return variant === 'row' ? `${label} service ${target}` : `${label} ${target}`
}

/** Start, Stop or Retry for an instance; a stop asks first if the demo has work in flight. */
export function InstanceLifecycleButton({
  instance,
  variant = 'bar',
  testId,
  className,
}: {
  instance: LifecycleTarget
  variant?: LifecycleButtonVariant
  testId?: string
  className?: string
}) {
  const { status, pending, pendingAction, run } = useServiceToggle(
    instance.instanceKey,
  )
  const { guard, dialog } = useInterruptionGuard()
  const action = actionFor(status)
  // A start or a retry after a failure has nothing running to interrupt.
  const onClick = () =>
    action === 'stop' ? guard([instance], 'stop', run) : run()
  const label = buttonLabel(variant, action, pendingAction)
  const starts = action !== 'stop' && !pending
  const filled = starts && variant !== 'row'

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={filled ? 'default' : 'outline'}
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={onClick}
        aria-label={buttonName(variant, action, label, pending, instance.label)}
        className={cn(
          'gap-2 font-semibold transition-colors',
          variant === 'bar' && 'h-9 min-w-28 px-3.5 shadow-sm',
          variant === 'sample' && 'gap-1.5',
          starts && (variant === 'row' ? ROW_START_CLASS : 'shadow-primary/15'),
          action === 'stop' && STOP_CLASS,
          className,
        )}
        data-testid={testId}
        data-action={action}
      >
        {pending ? (
          <Loader aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
        ) : action === 'stop' ? (
          <Square aria-hidden="true" className="h-3 w-3 fill-current" />
        ) : action === 'restart' ? (
          <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
        ) : (
          <Power aria-hidden="true" className="h-3.5 w-3.5" />
        )}
        {label}
      </Button>
      {dialog}
    </>
  )
}
