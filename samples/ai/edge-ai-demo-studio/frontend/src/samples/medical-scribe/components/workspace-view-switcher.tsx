// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { LucideIcon } from 'lucide-react'
import { ClipboardList, FileText, ListChecks, Loader } from 'lucide-react'
import type { Ref } from 'react'
import { cn } from '@/lib/utils'

/** The three parts of the workspace, one at a time on a narrow screen. */
export type ScribeView = 'sessions' | 'transcript' | 'report'

const SCRIBE_VIEWS: {
  id: ScribeView
  label: string
  icon: LucideIcon
}[] = [
  { id: 'sessions', label: 'Sessions', icon: ListChecks },
  { id: 'transcript', label: 'Transcript', icon: FileText },
  { id: 'report', label: 'Report', icon: ClipboardList },
]

/** The element id of a view's pane, for `aria-controls`. */
export const scribePaneId = (view: ScribeView) => `medical-scribe-${view}`

/** What is going on in each view, shown on its button while another is open. */
export interface ScribeViewActivity {
  /** The selected session is recording. */
  recording: boolean
  /** The selected session's audio is being transcribed. */
  processing: boolean
  /** The selected session's report is being written. */
  generating: boolean
  /** A report finished while another view was open, and was not opened since. */
  reportUnseen: boolean
}

/**
 * Picks the workspace view on a narrow screen (hidden where all three fit); each button shows
 * what is happening in its view, as a mark and in words for screen readers.
 */
export function WorkspaceViewSwitcher({
  view,
  onChange,
  activity,
  ref,
  className,
}: {
  view: ScribeView
  onChange: (view: ScribeView) => void
  activity: ScribeViewActivity
  ref?: Ref<HTMLDivElement>
  className?: string
}) {
  return (
    <div
      ref={ref}
      role="group"
      aria-label="Workspace view"
      data-testid="scribe-view-switcher"
      className={cn(
        'bg-muted grid grid-cols-3 gap-1 rounded-lg p-1',
        className,
      )}
    >
      {SCRIBE_VIEWS.map(({ id, label, icon: Icon }) => {
        const active = id === view
        return (
          <button
            key={id}
            type="button"
            data-view={id}
            data-testid={`scribe-view-${id}`}
            aria-pressed={active}
            aria-controls={scribePaneId(id)}
            onClick={() => onChange(id)}
            className={cn(
              'focus-visible:ring-ring/50 flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px]',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
            <ActivityMark view={id} activity={activity} />
          </button>
        )
      })}
    </div>
  )
}

function ActivityMark({
  view,
  activity,
}: {
  view: ScribeView
  activity: ScribeViewActivity
}) {
  if (view === 'transcript' && activity.recording) {
    return (
      <>
        <span
          className="bg-destructive h-2 w-2 shrink-0 animate-pulse rounded-full"
          aria-hidden
        />
        <span className="sr-only">(recording)</span>
      </>
    )
  }
  if (
    (view === 'transcript' && activity.processing) ||
    (view === 'report' && activity.generating)
  ) {
    return (
      <>
        <Loader className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
        <span className="sr-only">
          {view === 'report' ? '(writing)' : '(transcribing)'}
        </span>
      </>
    )
  }
  if (view === 'report' && activity.reportUnseen) {
    return (
      <>
        <span
          className="bg-primary h-2 w-2 shrink-0 rounded-full"
          aria-hidden
        />
        <span className="sr-only">(new report)</span>
      </>
    )
  }
  return null
}
