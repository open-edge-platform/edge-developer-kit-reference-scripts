// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { ServiceParamGroup } from '@/types/demo-params'
import type { TtsPlaybackControls } from '@/context/tts-playback-context'
import type { VoiceInputControls } from '@/context/voice-input-context'

/**
 * Optional-service integrations are headless "feature provider" components that
 * live inside their own service folder (so the folder can be pruned at export
 * time — see docs/OPTIONAL-SERVICES.md). Because a provider is a *component* it
 * can be conditionally mounted (unlike a hook, which can't be conditionally
 * called), and when its service folder is absent it simply isn't in the
 * generated registry and never mounts.
 *
 * A mounted provider reports two things up to its host sample:
 *  - `groups`: the Configure-sheet param groups it owns
 *  - `extraBody`: fields merged into the sample's chat/completion request body
 *
 * Reporting flows through this collector context. The host sample renders the
 * providers inside `collector.Provider` and reads the merged `groups` /
 * `extraBody` back from the `useFeatureCollector` hook.
 *
 * This module lives under `@/context` (neutral infrastructure) rather than
 * under `@/samples` so that the `services` tree can import the publish hooks
 * without depending on `samples` — keeping the two trees independently prunable
 * (see docs/OPTIONAL-SERVICES.md).
 */

/**
 * Strongly-typed named values a feature provider publishes for its host to read
 * back. Keyed explicitly (rather than an open record) so a typo or shape change
 * is a compile error instead of a silently-hidden control. Add a key here when
 * a new provider needs to export one.
 */
export interface FeatureExports {
  /** STT mic controls, consumed via VoiceInputContext. */
  voiceInput?: VoiceInputControls | null
  /** TTS per-message playback controls, consumed via TtsPlaybackContext. */
  ttsPlayback?: TtsPlaybackControls | null
  /** Whether the speech-to-text service is online. */
  sttOnline?: boolean
  /** Whether the text-to-speech service is online. */
  ttsOnline?: boolean
}

/** What a single provider contributes to its host sample. */
export interface FeatureContribution {
  groups?: ServiceParamGroup[]
  extraBody?: Record<string, unknown>
  /** Strongly-typed named values a host reads back (e.g. STT `voiceInput`). */
  exports?: FeatureExports
}

/** An imperative handle one provider exposes for another to call (e.g. STT's
 * `startRecording`, invoked by the wake-word provider). Stored in a ref so
 * cross-provider wiring never triggers re-renders. */
type FeatureHandle = (...args: unknown[]) => unknown

interface CollectorContextValue {
  register: (key: string, contribution: FeatureContribution) => void
  unregister: (key: string) => void
  setHandle: (key: string, fn: FeatureHandle | null) => void
  getHandle: (key: string) => FeatureHandle | undefined
}

const CollectorContext = createContext<CollectorContextValue | null>(null)

/**
 * Called inside a feature provider to publish its contribution. `groups` and
 * `extraBody` MUST be memoized by the provider so this re-registers only when
 * their content actually changes.
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

/**
 * Memoize a single param group into the stable one-element array
 * `useFeaturePublish` expects. Factored out because nearly every provider
 * publishes exactly one group.
 */
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
  /** Wraps the rendered feature providers so they can publish their contributions. */
  Provider: (props: { children: ReactNode }) => ReactNode
  /** All published param groups, ordered by `orderHint` (group.serviceId). */
  groups: ServiceParamGroup[]
  /** Merged request-body contributions across all mounted providers. */
  extraBody: Record<string, unknown>
  /** Merged named exports across all mounted providers (e.g. `voiceInput`). */
  exports: FeatureExports
}

/**
 * Collects contributions from the feature providers rendered inside
 * `collector.Provider`. `orderHint` is the desired Configure-sheet order keyed
 * by `ServiceParamGroup.serviceId` (e.g. `['speech-to-text','wake-word-detection',
 * 'vectordb','rerank','mcp']`) — pass a stable (module-level) array.
 */
export function useFeatureCollector(orderHint: string[]): FeatureCollectorApi {
  const [contributions, setContributions] = useState<
    Map<string, FeatureContribution>
  >(() => new Map())
  const handlesRef = useRef<Map<string, FeatureHandle>>(new Map())

  const register = useCallback(
    (key: string, contribution: FeatureContribution) => {
      setContributions((prev) => {
        const next = new Map(prev)
        next.set(key, contribution)
        return next
      })
    },
    [],
  )

  const unregister = useCallback((key: string) => {
    setContributions((prev) => {
      if (!prev.has(key)) return prev
      const next = new Map(prev)
      next.delete(key)
      return next
    })
  }, [])

  const setHandle = useCallback((key: string, fn: FeatureHandle | null) => {
    if (fn) handlesRef.current.set(key, fn)
    else handlesRef.current.delete(key)
  }, [])

  const getHandle = useCallback(
    (key: string) => handlesRef.current.get(key),
    [],
  )

  const ctxValue = useMemo<CollectorContextValue>(
    () => ({ register, unregister, setHandle, getHandle }),
    [register, unregister, setHandle, getHandle],
  )

  const Provider = useCallback(
    ({ children }: { children: ReactNode }) => (
      <CollectorContext.Provider value={ctxValue}>
        {children}
      </CollectorContext.Provider>
    ),
    [ctxValue],
  )

  // Stable string key so the memos below don't recompute on a fresh array literal.
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

  return { Provider, groups, extraBody, exports }
}
