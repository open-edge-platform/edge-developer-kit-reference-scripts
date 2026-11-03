// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ServiceConfigUpdate } from '@/hooks/use-service-config'

/** Why a draft cannot be created yet. */
export interface DraftIssue {
  message: string
  /** Waiting on something (devices being detected), not a mistake. */
  pending?: boolean
}

/** What a drafted panel would create, for the sheet's summary. */
export interface DraftPreview {
  model?: string
  device?: string
}

/**
 * Lets a Configure panel render inline as a draft in the New instance sheet, before its row exists.
 * Under a host, `useUpdateServiceConfig` hands the host the config instead of PATCHing a row, and
 * `EngineTabs` writes `engine` here instead of switching the row's engine.
 */
interface ConfigureDraftHost {
  /** The mounted panel's save handler and validity; `null` once it unmounts. */
  register: (panel: { save: () => void; valid: boolean } | null) => void
  /** Receives the config a panel's save would have sent. */
  capture: (config: ServiceConfigUpdate) => void
  /** The draft's execution engine; defaults to the source's resolved engine. */
  engine: string
  setEngine: (engine: string) => void
  /**
   * The source instance's engine, fixed at seeding. Tells a panel whether the draft targets another
   * engine, e.g. the multiserve panel must not poll (or offer to start) the source's engine.
   */
  sourceEngine: string
  /** Advanced settings shown; the sheet opens them to reveal a setting that needs attention. */
  advancedOpen: boolean
  setAdvancedOpen: (open: boolean) => void
  /** A problem that blocks creating the instance beyond the panel's validation; `null` clears. Stable. */
  setIssue: (key: string, issue: DraftIssue | null) => void
  /** Reports the model and device the panel currently holds. Stable. */
  setPreview: (preview: DraftPreview) => void
}

const ConfigureDraftContext = createContext<ConfigureDraftHost | null>(null)

export const ConfigureDraftProvider = ConfigureDraftContext.Provider

export function useConfigureDraftHost(): ConfigureDraftHost | null {
  return useContext(ConfigureDraftContext)
}

/** Reports the drafted model and device to the New instance sheet's summary; no-op outside a draft. */
export function useDraftPreview(
  model: string | undefined,
  device: string | undefined,
) {
  const setPreview = useConfigureDraftHost()?.setPreview
  useEffect(() => {
    setPreview?.({ model, device })
  }, [setPreview, model, device])
}

/**
 * Host side of a configure draft: pass `host` to `ConfigureDraftProvider`, and call `collect()` on
 * submit for the panel's configuration. `initialEngine` is only read on mount.
 */
export function useConfigureDraft(initialEngine: string) {
  const saveRef = useRef<(() => void) | null>(null)
  const capturedRef = useRef<ServiceConfigUpdate | undefined>(undefined)
  const [panelValid, setPanelValid] = useState(false)
  const [engine, setEngine] = useState(initialEngine)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [issues, setIssues] = useState<Record<string, DraftIssue>>({})
  const [preview, setPreviewState] = useState<DraftPreview>({})
  // Never updated; state rather than a ref because it is read during render.
  const [sourceEngine] = useState(initialEngine)

  // Stable (the compiler memoizes it), so fields can report from effects without re-running them.
  const setIssue = (key: string, issue: DraftIssue | null) => {
    setIssues((prev) => {
      const current = prev[key]
      if (
        current === issue ||
        (current &&
          issue &&
          current.message === issue.message &&
          current.pending === issue.pending)
      ) {
        return prev
      }
      const next = { ...prev }
      if (issue === null) delete next[key]
      else next[key] = issue
      return next
    })
  }
  const setPreview = (next: DraftPreview) => {
    setPreviewState((prev) =>
      prev.model === next.model && prev.device === next.device ? prev : next,
    )
  }

  const host: ConfigureDraftHost = {
    register: (panel) => {
      saveRef.current = panel?.save ?? null
      setPanelValid(panel?.valid ?? false)
    },
    capture: (config) => {
      capturedRef.current = config
    },
    engine,
    setEngine,
    sourceEngine,
    advancedOpen,
    setAdvancedOpen,
    setIssue,
    setPreview,
  }

  const collect = (): ServiceConfigUpdate | undefined => {
    capturedRef.current = undefined
    saveRef.current?.()
    // `as`: TS narrows this to `undefined` from the assignment above, not seeing `capture()` set it.
    return capturedRef.current as ServiceConfigUpdate | undefined
  }

  const issueList = Object.values(issues)
  return {
    host,
    valid: panelValid && issueList.length === 0,
    issues: issueList,
    preview,
    engine,
    collect,
    revealAdvanced: () => setAdvancedOpen(true),
  }
}
