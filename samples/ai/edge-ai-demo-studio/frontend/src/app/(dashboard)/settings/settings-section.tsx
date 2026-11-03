// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  Check,
  CircleAlert,
  CircleDot,
  Loader,
  RotateCw,
  TriangleAlert,
} from 'lucide-react'
import { type CSSProperties, type ReactNode, useId } from 'react'
import { InlineNotice } from '@/components/common/inline-notice'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { LoadState } from './hooks'
import type { SaveOutcome, SettingsField } from './settings-draft'

/** One section's load and save state, kept apart so one failed request never locks the page. */
export interface FieldState {
  field: SettingsField
  /** The setting in running text: "the saved {name} could not be loaded". */
  name: string
  load: LoadState
  onRetryLoad: () => void
  /** A draft that differs from the saved value. */
  dirty: boolean
  saving: boolean
  /** A save of any field is running; Retry waits for it to finish. */
  saveInProgress: boolean
  /** The last save's result for this field; cleared once it is edited. */
  outcome?: SaveOutcome
  onRetrySave: () => void
}

/** The section header's word on the field: never colour alone. */
function FieldStatusBadge({ state }: { state: FieldState }) {
  const testId = `settings-status-${state.field}`
  if (state.saving) {
    return (
      <Badge tone="muted" data-testid={testId} data-state="saving">
        <Loader aria-hidden="true" className="animate-spin" />
        Saving…
      </Badge>
    )
  }
  if (state.outcome && !state.outcome.ok) {
    return (
      <Badge tone="destructive" data-testid={testId} data-state="failed">
        <CircleAlert aria-hidden="true" />
        Not saved
      </Badge>
    )
  }
  if (state.dirty) {
    return (
      <Badge tone="warning" data-testid={testId} data-state="unsaved">
        <CircleDot aria-hidden="true" />
        Unsaved change
      </Badge>
    )
  }
  if (state.outcome?.ok) {
    return (
      <Badge tone="success" data-testid={testId} data-state="saved">
        <Check aria-hidden="true" />
        Saved
      </Badge>
    )
  }
  return null
}

/**
 * Stands in for the saved value until it loads. Fields stay disabled meanwhile, so no default is
 * ever shown or saved as if it were stored.
 */
function LoadNotice({ state }: { state: FieldState }) {
  const { load, name, field } = state
  if (load.status === 'ready') return null
  if (load.status === 'loading') {
    return (
      <p
        role="status"
        data-testid={`settings-load-${field}`}
        data-state="loading"
        className="text-muted-foreground flex items-center gap-2 text-xs"
      >
        <Loader aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
        Loading the saved {name}…
      </p>
    )
  }
  return (
    <InlineNotice
      tone="destructive"
      size="sm"
      data-testid={`settings-load-${field}`}
      icon={<TriangleAlert aria-hidden="true" className="h-4 w-4 shrink-0" />}
      action={
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={state.onRetryLoad}
          disabled={load.retrying}
          data-testid={`settings-retry-load-${field}`}
        >
          {load.retrying ? (
            <Loader aria-hidden="true" className="animate-spin" />
          ) : (
            <RotateCw aria-hidden="true" />
          )}
          {load.retrying ? 'Retrying…' : 'Retry'}
        </Button>
      }
    >
      The saved {name} could not be loaded: {load.message} It can be changed
      once it loads.
    </InlineNotice>
  )
}

/** Why the last save of this field failed; the draft is still in the field. */
function SaveFailureNotice({ state }: { state: FieldState }) {
  const { outcome, field, name } = state
  if (!outcome || outcome.ok) return null
  return (
    <InlineNotice
      tone="destructive"
      size="sm"
      // The page's save summary announces the result; this is the detail.
      role={null}
      data-testid={`settings-save-error-${field}`}
      icon={<CircleAlert aria-hidden="true" className="h-4 w-4 shrink-0" />}
      action={
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={state.onRetrySave}
          disabled={state.saveInProgress}
          aria-label={`Retry saving the ${name}`}
          data-testid={`settings-retry-save-${field}`}
        >
          <RotateCw aria-hidden="true" />
          Retry
        </Button>
      }
    >
      Your {name} change was not saved: {outcome.error} The change is kept here.
    </InlineNotice>
  )
}

export function SettingsSection({
  title,
  description,
  stagger,
  state,
  children,
}: {
  title: string
  description: string
  /** Position in the page's fade-in sequence. */
  stagger: number
  /** The section's setting: its load and save state shown around the fields. */
  state?: FieldState
  children: ReactNode
}) {
  const titleId = useId()
  return (
    <section
      aria-labelledby={titleId}
      aria-busy={state?.load.status === 'loading' || undefined}
      data-testid={state ? `settings-section-${state.field}` : undefined}
      className="section-fade glass-card space-y-4 rounded-xl p-4 sm:p-6"
      style={{ '--stagger': stagger } as CSSProperties}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h2 id={titleId} className="text-foreground text-lg font-semibold">
            {title}
          </h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        {state && <FieldStatusBadge state={state} />}
      </div>
      <Separator />
      {state && <LoadNotice state={state} />}
      {children}
      {state && <SaveFailureNotice state={state} />}
    </section>
  )
}
