// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { createContext, useContext, useEffect } from 'react'

/** One "term … value" line of the New instance sheet's summary. */
export interface DraftSummaryRow {
  label: string
  value: string
  /** A model id, path or address: monospaced and cut with an ellipsis. */
  mono?: boolean
}

/** A model the first start fetches, as far as the panel knows. */
export interface DraftDownload {
  label: string
  /** On disk already; unset when the catalogue does not say. */
  downloaded?: boolean
  /** A large download (`weight: 'heavy'`). */
  large?: boolean
}

/**
 * A drafted panel's own summary rows for the New instance sheet, replacing the generic Model and
 * Device rows, for services whose settings are not one model on one device.
 */
export interface DraftSummary {
  rows: DraftSummaryRow[]
  /** The models the first start downloads; `[]` when it downloads none. */
  downloads: DraftDownload[]
  /** Anything else the first start fetches or sets up, said as a sentence. */
  firstStartNote?: string
}

type ReportDraftSummary = (summary: DraftSummary | null) => void

const DraftSummaryContext = createContext<ReportDraftSummary | null>(null)

/** Provided by the New instance sheet around the drafted configure panel. */
export const DraftSummaryProvider = DraftSummaryContext.Provider

/** Equal summaries: a panel reports on every render, the sheet keeps one. */
export function sameDraftSummary(
  a: DraftSummary | null,
  b: DraftSummary | null,
): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Reports a drafting panel's {@link DraftSummary} to the New instance sheet; a no-op elsewhere.
 * Panels that only pick a model and a device need not call it.
 */
export function useDraftSummary(summary: DraftSummary) {
  const report = useContext(DraftSummaryContext)
  // Every render: the sheet ignores an equal summary, so no dependency list is needed.
  useEffect(() => {
    report?.(summary)
  })
  // Gone with the panel (another engine's panel replaced it).
  useEffect(() => () => report?.(null), [report])
}
