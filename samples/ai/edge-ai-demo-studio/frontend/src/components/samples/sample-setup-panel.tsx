// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Clock, Loader, RotateCcw, ScrollText, Wrench } from 'lucide-react'
import { useId, useState } from 'react'
import { ServiceLink } from '@/components/common/service-link'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { useTimeSince } from '@/hooks/use-time-since'
import { formatElapsed } from '@/lib/browser/format'
import { cn } from '@/lib/utils'
import {
  requiredSummary,
  type SampleReadinessView,
} from '@/samples/common/readiness'
import type { Sample } from '@/samples/types'
import { readinessStyle } from './readiness-styles'
import { SampleLaunchControl } from './sample-launch-control'
import { SampleSetupChecklist } from './sample-setup-checklist'
import { StartAllServicesButton } from './start-all-services-button'

/** Startup that has run this long gets an elapsed-time note (no ETA, no percentage). */
const STILL_STARTING_AFTER_MS = 20_000

interface SampleSetupPanelProps {
  sample: Sample
  view: SampleReadinessView
  onUseRecommendedConfig: () => void
  /** Opens the logs for one service (its `Service.id`), or the logs surface. */
  onViewLogs: (serviceId?: string) => void
  onRetry: () => void
  retrying?: boolean
  /** Bumping it folds the checklist back, unless the user opened it on purpose. */
  collapseSignal: number
}

/** "Prepare this sample": a status summary, one primary action, and the folded checklist. */
export function SampleSetupPanel({
  sample,
  view,
  onUseRecommendedConfig,
  onViewLogs,
  onRetry,
  retrying = false,
  collapseSignal,
}: SampleSetupPanelProps) {
  const headingId = useId()
  const [open, setOpen] = useChecklistOpen(view.needsAction, collapseSignal)

  return (
    <section
      aria-labelledby={headingId}
      className="surface-panel overflow-hidden rounded-xl"
    >
      <Accordion
        type="single"
        collapsible
        value={open ? 'services' : ''}
        onValueChange={(value) => setOpen(value !== '')}
      >
        <AccordionItem value="services" className="border-0">
          {/* The summary's flex basis, not a breakpoint, decides when the
              action wraps, so a long state label never squeezes the heading. */}
          <div className="flex flex-wrap items-start gap-x-4 gap-y-3 px-5 py-4">
            <SetupSummary view={view} headingId={headingId} />
            <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
              <SetupActions
                sample={sample}
                view={view}
                onViewLogs={onViewLogs}
                onRetry={onRetry}
                retrying={retrying}
              />
              <AccordionTrigger className="h-8 w-8 shrink-0 justify-end py-0 hover:no-underline [&>svg]:translate-y-0">
                <span className="sr-only">Toggle services details</span>
              </AccordionTrigger>
            </div>
          </div>

          <AccordionContent className="pb-0" data-testid="sample-setup-details">
            <SampleSetupChecklist
              sample={sample}
              view={view}
              onUseRecommendedConfig={onUseRecommendedConfig}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  )
}

/**
 * Opens on arrival when action is needed; the user's own choice wins after that. `collapseSignal`
 * folds it while the user has made no choice; a counter, so status polling never folds it.
 */
function useChecklistOpen(needsAction: boolean, collapseSignal: number) {
  const [userChoice, setUserChoice] = useState<'open' | 'closed' | null>(null)
  const [autoOpened, setAutoOpened] = useState(false)
  if (needsAction && !autoOpened) setAutoOpened(true)

  const [autoCollapsed, setAutoCollapsed] = useState(false)
  const [seenCollapseSignal, setSeenCollapseSignal] = useState(collapseSignal)
  if (collapseSignal !== seenCollapseSignal) {
    setSeenCollapseSignal(collapseSignal)
    if (userChoice === null) setAutoCollapsed(true)
  }

  const open = userChoice ? userChoice === 'open' : autoOpened && !autoCollapsed
  const setOpen = (next: boolean) => setUserChoice(next ? 'open' : 'closed')
  return [open, setOpen] as const
}

function SetupSummary({
  view,
  headingId,
}: {
  view: SampleReadinessView
  headingId: string
}) {
  const style = readinessStyle(view.state)
  const StateIcon = style.icon
  // In other states the count above already says everything.
  const showDetail =
    view.state === 'failed' ||
    view.state === 'unavailable' ||
    view.state === 'unverified'

  return (
    <div className="flex min-w-0 flex-1 basis-72 items-start gap-3">
      <span
        className={cn(
          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
          style.iconBg,
        )}
      >
        <StateIcon
          className={cn(
            'h-3.5 w-3.5',
            style.text,
            style.spin && 'animate-spin',
          )}
          aria-hidden
        />
      </span>
      <div className="min-w-0 flex-1">
        <h2
          id={headingId}
          className="text-foreground text-lg leading-tight font-semibold"
        >
          Prepare this sample
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {view.settled ? requiredSummary(view) : view.label}
        </p>
        {showDetail && view.detail && (
          <p className="text-muted-foreground mt-0.5 text-xs">{view.detail}</p>
        )}
        {view.staleNote && (
          <p className="text-muted-foreground mt-0.5 text-xs">
            {view.staleNote}
          </p>
        )}
        {view.compatibilityUnknown && view.state !== 'unverified' && (
          <p className="text-muted-foreground mt-0.5 text-xs">
            Compatibility not checked
          </p>
        )}
        {/* Announce state transitions once, quietly. */}
        <p role="status" aria-live="polite" className="sr-only">
          {view.label}
        </p>
      </div>
    </div>
  )
}

function SetupActions({
  sample,
  view,
  onViewLogs,
  onRetry,
  retrying,
}: {
  sample: Sample
  view: SampleReadinessView
  onViewLogs: (serviceId?: string) => void
  onRetry: () => void
  retrying: boolean
}) {
  const retryButton = (
    <Button
      size="sm"
      variant="outline"
      className="gap-2"
      onClick={onRetry}
      aria-busy={retrying || undefined}
    >
      <RotateCcw
        className={cn('h-4 w-4', retrying && 'animate-spin')}
        aria-hidden
      />
      Retry
    </Button>
  )

  switch (view.state) {
    case 'checking':
      return (
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
          <Loader className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Checking…
        </span>
      )
    case 'ready':
      return <SampleLaunchControl sample={sample} />
    case 'unverified':
      return (
        <>
          <SampleLaunchControl sample={sample} disabled />
          {retryButton}
        </>
      )
    case 'unavailable':
      return retryButton
    case 'needs-setup':
    case 'starting':
    case 'failed': {
      // When none is added yet, set up the first on its own page.
      const firstMissing =
        view.missing.length === view.requiredTotal ? view.missing[0] : undefined
      return (
        <>
          {firstMissing ? (
            <Button asChild size="sm" className="gap-2">
              <ServiceLink serviceType={firstMissing.serviceId}>
                <Wrench className="h-4 w-4" aria-hidden />
                Set up {firstMissing.name}
              </ServiceLink>
            </Button>
          ) : (
            <StartAllServicesButton dependencies={view.required} />
          )}
          {view.state === 'failed' && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => onViewLogs(view.failed[0]?.service?.id)}
            >
              <ScrollText className="h-3.5 w-3.5" aria-hidden />
              View logs
            </Button>
          )}
          {view.state === 'starting' && <StillStartingNote view={view} />}
        </>
      )
    }
    default:
      return null
  }
}

/**
 * Timed from the earliest recorded start, so it survives leaving the page. Its own component so
 * only this line re-renders on every tick.
 */
function StillStartingNote({ view }: { view: SampleReadinessView }) {
  const since = earliest(view.starting.map((d) => d.service?.startingSince))
  const elapsedMs = useTimeSince(since)
  if (elapsedMs < STILL_STARTING_AFTER_MS) return null
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
      <Clock className="h-3.5 w-3.5" aria-hidden />
      Still starting · {formatElapsed(elapsedMs)}
    </span>
  )
}

function earliest(times: (number | undefined)[]): number | undefined {
  const known = times.filter((t): t is number => t !== undefined)
  return known.length > 0 ? Math.min(...known) : undefined
}
