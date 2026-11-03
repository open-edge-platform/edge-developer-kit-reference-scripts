// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { ServiceParamGroup } from '@/types/demo-params'
import type { TtsPlaybackControls } from '@/context/tts-playback-context'
import type { VoiceInputControls } from '@/context/voice-input-context'

/**
 * Optional-service integrations are headless "feature provider" components in their own service
 * folder, so a pruned folder simply never mounts (docs/OPTIONAL-SERVICES.md). Each reports its
 * Configure-sheet `groups` and request `extraBody` to its host sample through this collector.
 * Lives under `@/context` so `services` can publish without depending on `samples`.
 */

/**
 * Named values a provider publishes for its host to read back. Keyed explicitly, not an open
 * record, so a typo or shape change is a compile error rather than a silently hidden control.
 */
export interface FeatureExports {
  /** STT mic controls, consumed via VoiceInputContext. */
  voiceInput?: VoiceInputControls | null
  /** TTS per-message playback controls, consumed via TtsPlaybackContext. */
  ttsPlayback?: TtsPlaybackControls | null
  sttOnline?: boolean
  ttsOnline?: boolean
}

/** What a single provider contributes to its host sample. */
export interface FeatureContribution {
  groups?: ServiceParamGroup[]
  extraBody?: Record<string, unknown>
  exports?: FeatureExports
}

/** A handle one provider exposes for another to call (e.g. STT's `startRecording` for wake word). */
type FeatureHandle = (...args: unknown[]) => unknown

/** Where mounted feature providers report to; one per host sample. */
export interface FeatureRegistry {
  register: (key: string, contribution: FeatureContribution) => void
  unregister: (key: string) => void
  setHandle: (key: string, fn: FeatureHandle | null) => void
  getHandle: (key: string) => FeatureHandle | undefined
}

const CollectorContext = createContext<FeatureRegistry | null>(null)

/** Wraps the rendered feature providers so they can publish to `value`. */
export function FeatureCollectorProvider({
  value,
  children,
}: {
  value: FeatureRegistry
  children: ReactNode
}) {
  return (
    <CollectorContext.Provider value={value}>
      {children}
    </CollectorContext.Provider>
  )
}

/**
 * Publishes a provider's contribution. `groups` and `extraBody` MUST be memoized so this
 * re-registers only when their content changes.
 */
export function useFeaturePublish(
  serviceId: string,
  contribution: FeatureContribution,
) {
  const ctx = useContext(CollectorContext)
  const { groups, extraBody, exports } = contribution
  useEffect(() => {
    if (!ctx) return
    ctx.register(serviceId, { groups, extraBody, exports })
    return () => ctx.unregister(serviceId)
  }, [ctx, serviceId, groups, extraBody, exports])
}

/** Memoizes one param group into the stable array `useFeaturePublish` expects. */
export function useSingletonGroup(
  group: ServiceParamGroup,
): ServiceParamGroup[] {
  return useMemo(() => [group], [group])
}

/** Access the cross-provider imperative handle bus (e.g. wake-word → STT). */
export function useFeatureHandles() {
  const ctx = useContext(CollectorContext)
  return {
    setHandle: ctx?.setHandle ?? noop,
    getHandle: ctx?.getHandle ?? (() => undefined),
  }
}

function noop() {}

export interface FeatureCollectorApi {
  /** For `FeatureCollectorProvider` around the rendered feature providers. */
  registry: FeatureRegistry
  /** All published param groups, ordered by `orderHint` (group.serviceId). */
  groups: ServiceParamGroup[]
  /** Merged request-body contributions across all mounted providers. */
  extraBody: Record<string, unknown>
  /** Merged named exports across all mounted providers (e.g. `voiceInput`). */
  exports: FeatureExports
}

/**
 * Collects contributions from the providers inside `<FeatureCollectorProvider>`. `orderHint` is the
 * Configure-sheet order, by `ServiceParamGroup.serviceId`.
 */
export function useFeatureCollector(orderHint: string[]): FeatureCollectorApi {
  const [contributions, setContributions] = useState<
    Map<string, FeatureContribution>
  >(() => new Map())
  // Providers publish from effects keyed on it, so it must never change identity. Handles are a
  // plain Map: they are called, never rendered.
  const [registry] = useState<FeatureRegistry>(() => {
    const handles = new Map<string, FeatureHandle>()
    return {
      register: (key, contribution) =>
        setContributions((prev) => new Map(prev).set(key, contribution)),
      unregister: (key) =>
        setContributions((prev) => {
          if (!prev.has(key)) return prev
          const next = new Map(prev)
          next.delete(key)
          return next
        }),
      setHandle: (key, fn) => {
        if (fn) handles.set(key, fn)
        else handles.delete(key)
      },
      getHandle: (key) => handles.get(key),
    }
  })

  // The merged results feed request bodies and publish effects, so memoize on a string key rather
  // than a caller's (possibly fresh) array.
  const orderKey = orderHint.join('|')

  const groups = useMemo(() => {
    const order = orderKey ? orderKey.split('|') : []
    const indexOf = (id: string) => {
      const i = order.indexOf(id)
      return i === -1 ? order.length : i
    }
    return [...contributions.values()]
      .flatMap((c) => c.groups ?? [])
      .sort((a, b) => indexOf(a.serviceId) - indexOf(b.serviceId))
  }, [contributions, orderKey])

  const extraBody = useMemo(() => {
    const order = orderKey ? orderKey.split('|') : []
    let merged: Record<string, unknown> = {}
    // Merge in orderHint order first for deterministic key precedence...
    for (const key of order) {
      const body = contributions.get(key)?.extraBody
      if (body) merged = { ...merged, ...body }
    }
    // ...then anything published under a key not listed in orderHint.
    for (const [key, c] of contributions) {
      if (!order.includes(key) && c.extraBody) {
        merged = { ...merged, ...c.extraBody }
      }
    }
    return merged
  }, [contributions, orderKey])

  const exports = useMemo(() => {
    let merged: FeatureExports = {}
    for (const c of contributions.values()) {
      if (c.exports) merged = { ...merged, ...c.exports }
    }
    return merged
  }, [contributions])

  return { registry, groups, extraBody, exports }
}
