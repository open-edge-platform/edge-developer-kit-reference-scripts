// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { createContext, type ReactNode, useContext } from 'react'
import {
  useBindSampleInstance,
  useResolvedSampleBindings,
  useSampleSettingsState,
} from '@/hooks/use-sample-settings'

/**
 * Which instance of each multi-instance service the shown sample uses. Under this provider, the
 * type lookups in `service-status-context` answer with the bound instance for each bound type, so
 * demos and service hooks follow the choice unaware of samples; other types resolve to the type's
 * primary instance. Lives in `@/context` so `services/*` can read it without importing `samples/`.
 */
export interface SampleInstancesValue {
  sampleId: string
  /** Service type → bound instance key (`type@instanceId`); only existing, added instances. */
  bindings: Record<string, string>
  /** The stored bindings could not be loaded; `bindings` is empty and must not be trusted as Automatic. */
  bindingsUnavailable: boolean
  /** Bind `type` to the instance whose services row id is `rowId`; `null` returns it to automatic. */
  bind: (type: string, rowId: number | null) => void
  /** The type whose binding is being changed right now, if any. */
  pendingType: string | null
}

const SampleInstancesContext = createContext<SampleInstancesValue | null>(null)

const NO_BINDINGS: Record<string, string> = {}

export function SampleInstancesProvider({
  sampleId,
  children,
}: {
  sampleId: string
  children: ReactNode
}) {
  const all = useResolvedSampleBindings()
  const bindings = all[sampleId] ?? NO_BINDINGS
  const { unavailable: bindingsUnavailable } = useSampleSettingsState()
  const { mutate, isPending, variables } = useBindSampleInstance()

  const pendingType = isPending && variables ? variables.type : null

  // The compiler keeps `value` stable while its parts are unchanged.
  const value: SampleInstancesValue = {
    sampleId,
    bindings,
    bindingsUnavailable,
    bind: (type, rowId) => mutate({ sampleId, type, instance: rowId }),
    pendingType,
  }

  return (
    <SampleInstancesContext.Provider value={value}>
      {children}
    </SampleInstancesContext.Provider>
  )
}

/** The sample's instance bindings, or `null` outside a sample page. */
export function useSampleInstances(): SampleInstancesValue | null {
  return useContext(SampleInstancesContext)
}

/**
 * The instance key a bare service type resolves to under the current sample; `undefined` for an
 * instance key, outside a sample page, or when the sample does not bind that type.
 */
export function useBoundInstanceKey(
  serviceIdOrKey: string,
): string | undefined {
  const ctx = useContext(SampleInstancesContext)
  if (!ctx || serviceIdOrKey.includes('@')) return undefined
  return ctx.bindings[serviceIdOrKey]
}

/**
 * The request-body `instances` field, so server routes (`boundInstanceKey`) reach the same
 * instances the browser does. `undefined` when nothing is bound, so spreading it is a no-op.
 */
export function useSampleInstancesBody():
  { instances: Record<string, string> } | undefined {
  const bindings = useContext(SampleInstancesContext)?.bindings
  return bindings && Object.keys(bindings).length > 0
    ? { instances: bindings }
    : undefined
}
