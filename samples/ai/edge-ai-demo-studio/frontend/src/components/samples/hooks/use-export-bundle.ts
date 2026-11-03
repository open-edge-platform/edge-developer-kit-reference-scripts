// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect, useEffectEvent, useState } from 'react'
import { useExternalStore } from '@/hooks/use-external-store'
import { fetchJson } from '@/lib/browser/fetch-json'
import type { ExportPhase, ExportPlan } from '@/lib/deployment/export-bundle'
import { getErrorMessage } from '@/lib/errors'
import {
  cancelExport,
  downloadExport,
  type ExportRun,
  exportKey,
  exportRuns,
  startExport,
  watchExport,
} from '../export-bundle-store'

export type { ExportPhase, ExportPlan }

const PLAN_QUERY_KEY = 'export-plan'

const NO_RUNS: ReadonlyMap<string, ExportRun> = new Map()

interface UseExportBundleOptions {
  sampleIds: string[]
  serviceIds: string[]
  /** What the selection is called, in notices shown outside the dialog. */
  title: string
  /** The dialog is open: resolve the plan. */
  open: boolean
  /** Called when the export finishes, and its download starts, while open. */
  onExported: () => void
}

/**
 * The export dialog's data: the selection's plan and its export (`export-bundle-store`). `close`
 * only stops a plan request in flight (`enabled: false` alone does not, and the dialog stays
 * mounted); only `cancelExport` stops an export.
 */
export function useExportBundle({
  sampleIds,
  serviceIds,
  title,
  open,
  onExported,
}: UseExportBundleOptions) {
  const queryClient = useQueryClient()
  const key = exportKey(sampleIds, serviceIds)
  const run = useExternalStore(exportRuns, NO_RUNS).get(key) ?? null

  // Reopening shows the selection's export with the options it was built with.
  const [includeOptional, setIncludeOptional] = useState(
    run?.includeOptional ?? false,
  )
  const [shownKey, setShownKey] = useState(key)
  if (shownKey !== key) {
    setShownKey(key)
    setIncludeOptional(run?.includeOptional ?? false)
  }

  // While open, the dialog hears when its export finishes (and closes);
  // while closed, a running export shows a notice instead.
  const exported = useEffectEvent(() => onExported())
  useEffect(() => {
    if (!open) return
    return watchExport(key, { onDone: () => exported() })
  }, [open, key])

  const samplesKey = sampleIds.join(',')
  const servicesKey = serviceIds.join(',')

  const planQuery = useQuery({
    queryKey: [PLAN_QUERY_KEY, samplesKey, servicesKey, includeOptional],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        includeOptional: String(includeOptional),
      })
      if (samplesKey) params.set('samples', samplesKey)
      if (servicesKey) params.set('services', servicesKey)
      return fetchJson<ExportPlan>(`/api/export-bundle?${params.toString()}`, {
        signal,
        errorMessage: 'Failed to resolve export plan',
      })
    },
    enabled: open && sampleIds.length + serviceIds.length > 0,
    placeholderData: keepPreviousData,
  })

  return {
    includeOptional,
    setIncludeOptional,
    plan: planQuery.data,
    planLoading: planQuery.isFetching,
    planError: planQuery.error
      ? getErrorMessage(planQuery.error, 'Failed to load plan')
      : null,
    refetchPlan: () => void planQuery.refetch(),
    run,
    exporting: run?.phase === 'running',
    startExport: () =>
      startExport({ sampleIds, serviceIds, includeOptional, title }),
    cancelExport: () => cancelExport(key),
    download: () => void downloadExport(key),
    close: () => {
      queryClient.cancelQueries({ queryKey: [PLAN_QUERY_KEY] })
    },
  }
}
