// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { cn } from '@mujoco-studio/ui';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { AccordionSection as SharedAccordionSection } from './AccordionGroup';
import type { RangeFields } from './generationPanelUtils';

export interface RangeRow {
  label: string;
  range: RangeFields;
  error: string | null;
  onChange: (range: RangeFields) => void;
  /** Tooltip on the row label. */
  hint?: string;
}

export function RangeTable({ rows, disabled }: { rows: readonly RangeRow[]; disabled: boolean }) {
  return (
    <div
      className="grid items-center gap-x-1.5 gap-y-1.5"
      style={{ gridTemplateColumns: 'minmax(0,1fr) 4.5rem 4.5rem' }}
    >
      <span aria-hidden />
      <span className="text-center text-[9px] text-muted">Min</span>
      <span className="text-center text-[9px] text-muted">Max</span>
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <span className="truncate text-[10px] text-muted" title={row.hint}>
            {row.label}
          </span>
          <input
            aria-label={`${row.label} minimum`}
            aria-invalid={Boolean(row.error)}
            className="h-7 w-full border border-border bg-background px-1 text-center text-[11px] text-foreground"
            disabled={disabled}
            step="any"
            type="number"
            value={row.range.min}
            onChange={(event) => row.onChange({ ...row.range, min: event.target.value })}
          />
          <input
            aria-label={`${row.label} maximum`}
            aria-invalid={Boolean(row.error)}
            className="h-7 w-full border border-border bg-background px-1 text-center text-[11px] text-foreground"
            disabled={disabled}
            step="any"
            type="number"
            value={row.range.max}
            onChange={(event) => row.onChange({ ...row.range, max: event.target.value })}
          />
        </div>
      ))}
    </div>
  );
}

const SECTION_IDS = ['randomization', 'episodes'] as const;
export type GenerateSectionId = (typeof SECTION_IDS)[number];

/** A Generate section; same accordion as Simulate, so only one section is open at a time. */
export function AccordionSection({
  title,
  summary,
  summaryTone = 'text-muted',
  sectionId,
  children,
}: {
  title: string;
  summary: string;
  summaryTone?: string;
  sectionId: GenerateSectionId;
  children: ReactNode;
}) {
  return (
    <SharedAccordionSection
      group="generate"
      ids={SECTION_IDS}
      sectionId={sectionId}
      title={title}
      aside={
        <span className={cn('max-w-[55%] truncate text-[10px]', summaryTone)} title={summary}>
          {summary}
        </span>
      }
    >
      {children}
    </SharedAccordionSection>
  );
}

export function Feedback({
  error,
  message,
  warning,
}: {
  error: string | null;
  message: string | null;
  warning?: string | null;
}) {
  if (!error && !message && !warning) return null;
  return (
    <div className="space-y-1 border-t border-border pt-3 text-[10px] leading-relaxed">
      {error && <p className="text-danger">{error}</p>}
      {warning && <p className="text-warning">{warning}</p>}
      {message && <p className="text-success">{message}</p>}
    </div>
  );
}

// Warm starts finish before this, so the notice never flashes.
const STARTUP_NOTICE_DELAY_SECONDS = 2;

/**
 * Mount while the native worker starts; the first start on a machine compiles graphics code. An
 * inline notice, not a dialog, so the rest of the editor stays usable while it waits.
 */
export function WorkerStartupNotice() {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);
  if (elapsedSeconds < STARTUP_NOTICE_DELAY_SECONDS) return null;
  return (
    <div
      role="status"
      aria-label="Getting the simulator ready"
      className="flex gap-2 border-b border-border bg-info/5 px-3 py-2 text-[10px] leading-relaxed"
    >
      <LoaderCircle
        className="mt-0.5 size-3.5 shrink-0 animate-spin text-info"
        aria-hidden="true"
      />
      <div>
        <p className="font-medium text-foreground">
          Getting the simulator ready ({elapsedSeconds} s)
        </p>
        <p className="text-muted">
          The first start on this machine prepares the graphics, which can take a minute or two. You
          can keep working meanwhile.
        </p>
      </div>
    </div>
  );
}
